/**
 * prompt-sanitizer.ts — 전역 프롬프트 sanitizer
 *
 * 모든 generation path에서 final payload 직전에 실행.
 * 특정 장면 전용이 아닌 시스템 전역 규칙.
 *
 * 파이프라인 순서:
 * 1. sanitizePositiveNegativeConflicts
 * 2. applySceneTypeVocabularyRules (scene-type-rules.ts)
 * 3. resolveCameraConflicts
 * 4. rewriteTemporalFlowForSceneType
 * 5. ensureEnvironmentDetailCoverage
 */

import {
  type SceneType,
  resolveSceneType,
  applySceneTypeVocabularyRules,
  ensureDescriptiveCoverage,
} from "@/lib/scene-type-rules";

// ═══════════════════════════════════════════════════════════════════
// 1. Positive / Negative Conflict Sanitizer
// ═══════════════════════════════════════════════════════════════════

/** 중점 검사 대상 단어 — 이 단어들이 positive와 negative에 동시 존재하면 반드시 해결 */
const CRITICAL_CONFLICT_WORDS = [
  "watermark", "caption", "subtitle", "logo",
  "photorealistic", "cinematic", "text overlay",
  "blurry", "low quality",
];

export interface PosNegConflictResult {
  /** 정리된 positive 텍스트 */
  positive: string;
  /** 정리된 negative 배열 */
  negatives: string[];
  /** 제거된 충돌 항목 */
  conflicts: Array<{ word: string; removedFrom: "positive" | "negative"; reason: string }>;
}

/**
 * Positive와 Negative 간 충돌을 해결.
 *
 * 규칙:
 * - negative 키워드가 positive에 포함 → positive에서 해당 구절 제거
 * - 단, "no watermark", "no text overlay" 같은 금지 구문은 보존
 * - 중복 negative 제거
 */
export function sanitizePositiveNegativeConflicts(
  positiveText: string,
  negatives: string[],
): PosNegConflictResult {
  const conflicts: PosNegConflictResult["conflicts"] = [];
  let cleanedPositive = positiveText;

  // 1. 중점 검사 단어 먼저 처리
  for (const word of CRITICAL_CONFLICT_WORDS) {
    const wordLower = word.toLowerCase();
    const posLower = cleanedPositive.toLowerCase();
    const isInNeg = negatives.some(n => n.toLowerCase().includes(wordLower));

    if (isInNeg && posLower.includes(wordLower)) {
      // positive에서 "no watermark" 같은 부정 구문은 보존
      const noPattern = new RegExp(`\\bno\\s+${escapeRegex(word)}\\b`, "gi");
      const avoidPattern = new RegExp(`\\bavoid\\s+${escapeRegex(word)}\\b`, "gi");
      const withoutPattern = new RegExp(`\\bwithout\\s+${escapeRegex(word)}\\b`, "gi");

      if (noPattern.test(cleanedPositive) || avoidPattern.test(cleanedPositive) || withoutPattern.test(cleanedPositive)) {
        // "no watermark" 같은 부정 구문은 OK — 충돌 아님
        continue;
      }

      // positive에서 해당 단어 제거
      const removePattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
      cleanedPositive = cleanedPositive.replace(removePattern, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
      conflicts.push({ word, removedFrom: "positive", reason: `"${word}" in both positive and negatives — removed from positive` });
    }
  }

  // 2. 그 외 모든 negative에 대해 positive에서 충돌 검사
  for (const neg of negatives) {
    const negLower = neg.toLowerCase().trim();
    if (negLower.length <= 3) continue; // 너무 짧은 건 스킵

    const posLower = cleanedPositive.toLowerCase();
    if (posLower.includes(negLower)) {
      // "no X" / "avoid X" / "without X" 패턴이면 보존
      const noCheck = new RegExp(`\\b(?:no|avoid|without)\\s+${escapeRegex(neg)}\\b`, "i");
      if (noCheck.test(cleanedPositive)) continue;

      const removePattern = new RegExp(`\\b${escapeRegex(neg)}\\b`, "gi");
      cleanedPositive = cleanedPositive.replace(removePattern, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
      conflicts.push({ word: neg, removedFrom: "positive", reason: `"${neg}" in both positive and negatives` });
    }
  }

  // 3. 중복 negative 제거
  const seen = new Set<string>();
  const dedupedNeg = negatives.filter(n => {
    const key = n.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. 정리
  cleanedPositive = cleanedPositive
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { positive: cleanedPositive, negatives: dedupedNeg, conflicts };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Camera Conflict Resolver
// ═══════════════════════════════════════════════════════════════════

/** 프레이밍 크기 카테고리 */
const FRAMING_CATEGORIES = {
  wide: /\b(wide[\s-]?shot|wide[\s-]?angle|establishing\s+shot|WS|LS|aerial|panoram|drone\s+shot)\b/i,
  medium: /\b(medium\s+shot|medium[\s-]?close|MS|MCU|MLS|mid[\s-]?shot)\b/i,
  close: /\b(close[\s-]?up|extreme\s+close|ECU|CU|macro|detail\s+shot)\b/i,
};

export interface CameraConflictResult {
  text: string;
  framing: string;
  conflicts: string[];
}

/**
 * 하나의 shot 안에서 wide/medium/close-up 동시 존재를 해결.
 * 선언된 framing을 기준으로, 충돌하는 프레이밍 언급을 제거.
 */
export function resolveCameraConflicts(
  text: string,
  declaredFraming: string,
  shotCategory?: string,
): CameraConflictResult {
  const conflicts: string[] = [];
  let result = text;
  const framingUpper = declaredFraming.toUpperCase();

  // 선언된 framing의 카테고리 결정
  let declaredCategory: "wide" | "medium" | "close" = "medium";
  if (["WS", "LS", "MLS"].includes(framingUpper)) declaredCategory = "wide";
  else if (["CU", "ECU", "MCU"].includes(framingUpper)) declaredCategory = "close";

  // Environment scene은 wide 강제
  const sceneType = resolveSceneType(shotCategory);
  if (sceneType === "environment") declaredCategory = "wide";

  // 충돌하는 카테고리의 프레이밍 언급 제거
  for (const [cat, pattern] of Object.entries(FRAMING_CATEGORIES)) {
    if (cat === declaredCategory) continue;
    const matches = result.match(pattern);
    if (matches) {
      result = result.replace(pattern, "");
      conflicts.push(`Removed ${cat} framing "${matches[0]}" (conflicts with declared ${declaredCategory} framing "${declaredFraming}")`);
    }
  }

  // 정리
  result = result.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").trim();

  return { text: result, framing: declaredFraming, conflicts };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Temporal Rewrite
// ═══════════════════════════════════════════════════════════════════

/**
 * Cut-list 스타일의 fragmented timing을 연속적인 카메라 흐름으로 rewrite.
 *
 * 변환 전: "0-2s wide shot, 2-5s medium shot, 5-8s close-up"
 * 변환 후: "single continuous wide-to-closer push without cuts"
 *
 * 변환 조건:
 * - 하나의 prompt 안에 서로 다른 framing이 time-segmented로 나열
 * - environment scene이면 연속 모션으로 강제 변환
 */
export interface TemporalRewriteResult {
  text: string;
  rewrites: string[];
}

/** Cut-list 패턴 감지: "Ns-Ns: [desc]" 형태가 2개 이상, 서로 다른 framing 포함 */
const CUT_LIST_PATTERN = /(\d+)s?\s*[-–]\s*(\d+)s?\s*:?\s*([^.]+)/g;

export function rewriteTemporalFlowForSceneType(
  text: string,
  shotCategory?: string,
): TemporalRewriteResult {
  const rewrites: string[] = [];
  let result = text;

  const sceneType = resolveSceneType(shotCategory);

  // 1. Cut-list 스타일 감지
  const segments: Array<{ start: number; end: number; desc: string; fullMatch: string }> = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(CUT_LIST_PATTERN.source, "g");
  while ((match = regex.exec(text)) !== null) {
    segments.push({
      start: parseInt(match[1]),
      end: parseInt(match[2]),
      desc: match[3].trim(),
      fullMatch: match[0],
    });
  }

  if (segments.length < 2) return { text, rewrites };

  // 2. 서로 다른 framing이 segment별로 다른지 확인
  const hasFramingSwitch = segments.some(seg => {
    const desc = seg.desc.toLowerCase();
    return FRAMING_CATEGORIES.wide.test(desc) ||
           FRAMING_CATEGORIES.medium.test(desc) ||
           FRAMING_CATEGORIES.close.test(desc);
  });

  // 3. Environment/crowd scene이면 연속 모션으로 강제 rewrite
  if (sceneType === "environment" || sceneType === "crowd") {
    if (hasFramingSwitch) {
      // Framing이 바뀌는 cut-list → 연속 모션으로 변환
      const totalDuration = segments[segments.length - 1].end;
      const descriptions = segments.map(s => s.desc
        .replace(FRAMING_CATEGORIES.wide, "")
        .replace(FRAMING_CATEGORIES.medium, "")
        .replace(FRAMING_CATEGORIES.close, "")
        .replace(/,\s*,/g, ",")
        .trim()
      ).filter(Boolean);

      // 원본 cut-list 제거
      for (const seg of segments) {
        result = result.replace(seg.fullMatch, "");
      }

      // 연속 모션으로 재작성
      const rewritten = `0s-${totalDuration}s: single continuous camera movement — ${descriptions.join(", then ")}`;
      result = result.trim() + ". " + rewritten;
      rewrites.push(`Rewrote ${segments.length}-segment cut-list to continuous motion for ${sceneType} scene`);
    } else {
      // Framing은 같지만 "cut to" 스타일 언어 제거
      const cutPhrases = /\b(cut\s+to|dissolve\s+to|fade\s+to|wipe\s+to|jump\s+cut|smash\s+cut)\b/gi;
      const before = result;
      result = result.replace(cutPhrases, "then");
      if (result !== before) {
        rewrites.push("Replaced cut-based transition phrases with continuous flow language");
      }
    }
  } else if (hasFramingSwitch) {
    // 비-environment scene이라도 framing 혼합 경고
    // 하지만 강제 rewrite하지는 않음 — 경고만
    rewrites.push(`WARNING: ${segments.length} time segments with mixed framings detected — consider using consistent framing`);
  }

  // 4. 단편적 cut-list 표현 정리 (모든 씬 타입 공통)
  result = result
    .replace(/\b(cut\s+to\s+)/gi, "then ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { text: result, rewrites };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Environment Detail Coverage
// ═══════════════════════════════════════════════════════════════════

export interface EnvironmentDetailResult {
  text: string;
  additions: string[];
  coverage: { covered: number; total: number };
}

/**
 * Environment scene에서 최소 묘사 요소를 강제.
 * word-count minimum이 아니라 descriptive coverage minimum으로 검사.
 *
 * 필수 요소:
 * - sky condition
 * - light quality
 * - atmospheric particles / haze / smoke / dust
 * - ground or architectural texture
 * - scale cues
 */
export function ensureEnvironmentDetailCoverage(
  text: string,
  shotCategory?: string,
): EnvironmentDetailResult {
  const sceneType = resolveSceneType(shotCategory);
  if (!sceneType || (sceneType !== "environment" && sceneType !== "map_visualization")) {
    return { text, additions: [], coverage: { covered: 0, total: 0 } };
  }

  const { additions, coverage, total } = ensureDescriptiveCoverage(text, sceneType);

  if (additions.length === 0) {
    return { text, additions: [], coverage: { covered: coverage, total } };
  }

  // 부족한 요소를 텍스트 끝에 추가
  const enriched = text.trim() + ". " + additions.join(", ");

  return {
    text: enriched.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim(),
    additions,
    coverage: { covered: coverage, total },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. 전체 Sanitize Pipeline
// ═══════════════════════════════════════════════════════════════════

export interface SanitizePipelineInput {
  /** 최종 prompt 문자열 */
  prompt: string;
  /** Negative 배열 */
  negatives: string[];
  /** 선언된 카메라 프레이밍 */
  framing: string;
  /** 씬 타입 (shotCategory) */
  shotCategory?: string;
  /** Style suffix (positive side) */
  styleSuffix?: string;
}

export interface SanitizePipelineResult {
  prompt: string;
  negatives: string[];
  framing: string;
  log: string[];
  /** 파이프라인 통과 여부 (false면 아직 문제 있음) */
  clean: boolean;
}

/**
 * 전체 sanitize 파이프라인 실행.
 *
 * 순서:
 * 1. scene-type vocabulary filtering
 * 2. positive/negative conflict resolution
 * 3. camera conflict resolution
 * 4. temporal flow rewrite
 * 5. environment detail coverage
 */
export function runSanitizePipeline(input: SanitizePipelineInput): SanitizePipelineResult {
  const log: string[] = [];
  let { prompt, negatives, framing } = input;

  // 1. Scene-type vocabulary filtering
  const sceneType = resolveSceneType(input.shotCategory);
  if (sceneType) {
    const vocabResult = applySceneTypeVocabularyRules(prompt, sceneType, framing);
    prompt = vocabResult.text;
    if (vocabResult.removals.length > 0) {
      log.push(`[vocab] Removed banned terms: ${vocabResult.removals.join(", ")}`);
    }
    if (vocabResult.replacements.length > 0) {
      log.push(`[vocab] Replaced: ${vocabResult.replacements.join("; ")}`);
    }
    if (vocabResult.framingChange) {
      framing = vocabResult.framingChange.to;
      log.push(`[vocab] Framing downgraded: ${vocabResult.framingChange.from} → ${vocabResult.framingChange.to}`);
    }
  }

  // 2. Positive/negative conflict resolution
  const fullPositive = input.styleSuffix
    ? `${prompt} ${input.styleSuffix}`
    : prompt;
  const posNegResult = sanitizePositiveNegativeConflicts(fullPositive, negatives);
  // styleSuffix 부분을 prompt에서 다시 분리
  if (input.styleSuffix) {
    const suffixLen = input.styleSuffix.length;
    prompt = posNegResult.positive.slice(0, -(suffixLen + 1)).trim() || posNegResult.positive;
  } else {
    prompt = posNegResult.positive;
  }
  negatives = posNegResult.negatives;
  if (posNegResult.conflicts.length > 0) {
    log.push(`[pos-neg] Resolved ${posNegResult.conflicts.length} conflicts: ${posNegResult.conflicts.map(c => c.word).join(", ")}`);
  }

  // 3. Camera conflict resolution
  const cameraResult = resolveCameraConflicts(prompt, framing, input.shotCategory);
  prompt = cameraResult.text;
  if (cameraResult.conflicts.length > 0) {
    log.push(`[camera] ${cameraResult.conflicts.join("; ")}`);
  }

  // 4. Temporal flow rewrite
  const temporalResult = rewriteTemporalFlowForSceneType(prompt, input.shotCategory);
  prompt = temporalResult.text;
  if (temporalResult.rewrites.length > 0) {
    log.push(`[temporal] ${temporalResult.rewrites.join("; ")}`);
  }

  // 5. Environment detail coverage
  const envResult = ensureEnvironmentDetailCoverage(prompt, input.shotCategory);
  prompt = envResult.text;
  if (envResult.additions.length > 0) {
    log.push(`[env-detail] Added ${envResult.additions.length} missing elements: ${envResult.additions.join(", ")}`);
  }

  // 최종 정리
  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    prompt,
    negatives,
    framing,
    log,
    clean: log.length === 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
