/**
 * final-payload-builder.ts — 최종 provider payload 단일 조립 경로
 *
 * 이 파일이 provider에 전송되는 payload를 만드는 유일한 경로다.
 * 다른 파일에서 prompt 문자열을 조립해서 직접 provider에 보내면 안 된다.
 *
 * 파이프라인:
 * 1. sceneType 규칙 적용
 * 2. positive/negative conflict sanitize
 * 3. camera conflict resolution
 * 4. lighting normalization
 * 5. descriptive coverage enforcement
 * 6. serialize (provider가 string-only일 때)
 * 7. final payload validate + auto-fix loop
 * 8. hard-block if errors remain
 */

import { serializeForProvider, type SingleShotDocument } from "@/lib/sequence-assembler";
import { validateFinalProviderPayload } from "@/lib/final-payload-validator";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface BuildFinalPayloadInput {
  /** Normalized SingleShotDocument (assembleFromJSON 산출물) */
  document: SingleShotDocument;
  provider: "veo";
}

export interface FinalProviderPayload {
  /** Provider에 전송할 최종 prompt 문자열 */
  prompt: string;
  /** VEO 전용: 별도 negative prompt */
  negativePrompt: string;
  /** word count */
  wordCount: number;
  /** validation 통과 여부 */
  valid: boolean;
  /** validation 에러가 남아 있으면 generation 차단 */
  blocked: boolean;
  blockReason?: string;
  /** 디버그 정보 */
  debug: {
    sections: Record<string, string>;
    truncated: boolean;
    sanitizeLog: string[];
    autoFixes: string[];
    validationIssues: string[];
    /** 이 payload가 buildFinalProviderPayload()에서 생성되었음을 보장 */
    builtBy: "buildFinalProviderPayload";
    /** 전송 직전 snapshot — 로그와 실제 전송 payload 일치 보장용 */
    payloadSnapshot: string;
    /** Gemini step1/2/3에서 토큰 절단이 발생했는지 추적 (upstream에서 주입) */
    upstreamTruncated?: boolean;
    /** Gemini parse mode (upstream에서 주입) */
    upstreamParseMode?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Critical conflict words — final payload에서 0건이어야 하는 단어
// ═══════════════════════════════════════════════════════════════════

import { CRITICAL_CONFLICT_WORDS as ZERO_TOLERANCE_WORDS } from "@/lib/critical-words";

// ═══════════════════════════════════════════════════════════════════
// Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * 최종 provider payload를 조립하는 **유일한** 함수.
 *
 * 이 함수 외부에서 prompt 문자열을 직접 조립하여 provider에 전송하면 안 된다.
 * source of truth: SingleShotDocument → 이 함수 → provider
 */
export function buildFinalProviderPayload(input: BuildFinalPayloadInput): FinalProviderPayload {
  const { document: doc, provider } = input;
  const sanitizeLog: string[] = [];
  const autoFixes: string[] = [];

  // ── Step 1: Serialize (JSON → string) ──────────────────────────
  // serializeForProvider 내부에서:
  //   - runSanitizePipeline (sceneType rules, pos/neg, camera, temporal, coverage)
  //   - validateFinalProviderPayload + autoFixPayload loop (최대 3회)
  //   - word cap + cleanup
  const serialized = serializeForProvider(doc, provider);

  let prompt = serialized.prompt;
  const negativePrompt = serialized.negativePrompt;

  // Collect debug info from serialization
  if (serialized.debug.sections._sanitizeLog) {
    sanitizeLog.push(...serialized.debug.sections._sanitizeLog.split(" | "));
  }
  if (serialized.debug.sections._autoFixes) {
    autoFixes.push(...serialized.debug.sections._autoFixes.split(" | "));
  }

  // ── Step 2: Final pos/neg hard-fix ─────────────────────────────
  // serializeForProvider 이후에도 한 번 더 검사.
  // "Avoid:" 섹션 분리 후 본문만 검사.
  const avoidIdx = prompt.search(/\.\s*Avoid:\s*/i);
  const promptBody = avoidIdx >= 0 ? prompt.slice(0, avoidIdx) : prompt;
  const avoidSection = avoidIdx >= 0 ? prompt.slice(avoidIdx) : "";

  // 본문에서 negative에 있는 critical word를 "no X" 가드 없이 사용하고 있으면 제거
  const allNeg = negativePrompt ? negativePrompt.split(", ") : [];
  // 영상 모델은 negative가 Avoid: 에 embed 되므로 serialized의 debug에서 꺼냄
  const negWords = provider === "veo" ? allNeg : extractAvoidWords(avoidSection);
  let cleanedBody = promptBody;

  for (const word of ZERO_TOLERANCE_WORDS) {
    const wordLower = word.toLowerCase();
    const inNeg = negWords.some(n => n.toLowerCase().includes(wordLower));
    if (!inNeg) continue;

    const bodyLower = cleanedBody.toLowerCase();
    if (!bodyLower.includes(wordLower)) continue;

    // Guard: "no watermark", "no text overlay, no watermark" 등 보존
    const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${escapeRe(word)}\\b`, "i");
    if (guardRe.test(cleanedBody)) continue;

    // Hard-fix: 제거
    const removeRe = new RegExp(`\\b${escapeRe(word)}\\b`, "gi");
    cleanedBody = cleanedBody.replace(removeRe, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
    autoFixes.push(`[final-builder] Hard-fixed: removed "${word}" from prompt body`);
  }

  prompt = cleanedBody + avoidSection;
  prompt = prompt.replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();

  // ── Step 3: Final validation — hard-block if errors remain ─────
  const finalValidation = validateFinalProviderPayload({
    prompt: prompt.replace(/\.\s*Avoid:\s*.*/i, ""), // validate body only
    negatives: negWords,
    framing: doc.camera.framing,
    shotCategory: doc.scene.shotCategory,
    provider,
  });

  const validationIssues = finalValidation.issues.map(i => `[${i.severity}] ${i.rule}: ${i.message}`);
  const errorCount = finalValidation.issues.filter(i => i.severity === "error").length;
  const posNegErrors = finalValidation.issues.filter(i => i.rule === "pos_neg_conflict");

  let blocked = false;
  let blockReason: string | undefined;

  if (posNegErrors.length > 0) {
    // pos_neg_conflict는 절대 허용 안 함 — hard block
    blocked = true;
    blockReason = `pos_neg_conflict가 auto-fix 이후에도 ${posNegErrors.length}건 남음: ${posNegErrors.map(e => e.message).join("; ")}`;
  } else if (errorCount > 0 && !finalValidation.autoFixable) {
    blocked = true;
    blockReason = `${errorCount} validation errors remaining after auto-fix`;
  }

  // ── Step 4: Payload snapshot (consistency guarantee) ────────────
  const payloadSnapshot = JSON.stringify({ prompt, negativePrompt, provider });

  return {
    prompt,
    negativePrompt,
    wordCount: prompt.split(/\s+/).length,
    valid: errorCount === 0,
    blocked,
    blockReason,
    debug: {
      sections: serialized.debug.sections,
      truncated: serialized.debug.truncated,
      sanitizeLog,
      autoFixes,
      validationIssues,
      builtBy: "buildFinalProviderPayload",
      payloadSnapshot,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Avoid: watermark, caption, blurry" → ["watermark", "caption", "blurry"] */
function extractAvoidWords(avoidSection: string): string[] {
  const match = avoidSection.match(/Avoid:\s*(.+)/i);
  if (!match) return [];
  return match[1].split(",").map(s => s.trim()).filter(Boolean);
}
