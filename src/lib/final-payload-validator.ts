/**
 * final-payload-validator.ts — 최종 payload 검증기
 *
 * provider에 전송하기 직전, 마지막으로 한 번 더 검사.
 * 앞 단계(sanitize/rewrite/conflict resolution)에서 고친 규칙이
 * 최종 조립에서 다시 깨지지 않도록 보장.
 *
 * 하나라도 FAIL이면 전송하지 않고 에러를 반환해야 한다.
 */

import { resolveSceneType, getSceneTypeRule } from "@/lib/scene-type-rules";

// ═══════════════════════════════════════════════════════════════════
// 1. Validation Rules
// ═══════════════════════════════════════════════════════════════════

export interface PayloadValidationIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export interface PayloadValidationResult {
  valid: boolean;
  issues: PayloadValidationIssue[];
  /** 자동 수정 가능한 항목이 있으면 true */
  autoFixable: boolean;
}

export interface ValidatePayloadInput {
  /** 최종 prompt 문자열 */
  prompt: string;
  /** Negative prompt (embedded 또는 separate) */
  negatives: string[];
  /** 선언된 프레이밍 */
  framing: string;
  /** 카메라 모션 */
  motion?: string;
  /** 씬 타입 */
  shotCategory?: string;
  /** Provider */
  provider: "kling";
  /** characterRef (있으면 검증) */
  characterRef?: string;
  /** action 텍스트 (있으면 overload/consistency 검증) */
  actionText?: string;
  /** shot duration */
  durationSec?: number;
  /** multi-shot 배열 (export layer 검증) */
  multiShots?: Array<{ index: number; prompt: string; duration: string; role?: string }>;
  /** Kling 모델 ID (multiShot 검증 시 필요) */
  modelId?: string;
}

// ── 중점 검사 단어 ────────────────────────────────────────────────

const POS_NEG_CRITICAL_WORDS = [
  "watermark", "caption", "subtitle", "logo",
  "photorealistic", "cinematic", "text overlay",
];

// ── Environment 금지 어휘 ──────────────────────────────────────────

const ENV_BANNED_IN_PROMPT = [
  /\bsoldiers?\b/i,
  /\bclose[\s-]?up\s+(?:face|portrait)\b/i,
  /\bmedium\s+portrait\b/i,
  /\bcharacter[\s-]?focused\b/i,
];

// ── 프레이밍 충돌 감지 ─────────────────────────────────────────────

const WIDE_TERMS = /\b(wide[\s-]?shot|WS|LS|establishing|aerial|panoram)\b/i;
const MEDIUM_TERMS = /\b(medium\s+shot|MS|MCU|MLS|mid[\s-]?shot)\b/i;
const CLOSE_TERMS = /\b(close[\s-]?up|CU|ECU|macro|detail\s+shot)\b/i;

// ── Cut-list 스타일 감지 ──────────────────────────────────────────

const CUT_LIST_WITH_FRAMING = /\d+s?\s*[-–]\s*\d+s?\s*:?\s*[^.]*\b(wide|medium|close|CU|WS|MS|LS|ECU|MCU)\b/i;

// ── Environment descriptive coverage 최소 기준 ────────────────────

const ENV_COVERAGE_CHECKS = [
  { name: "sky", pattern: /\b(sky|cloud|sun|moon|star|dawn|dusk|twilight|overcast)\b/i },
  { name: "light", pattern: /\b(light|sunlight|moonlight|golden|shadow|illuminat|backlit|sidelit)\b/i },
  { name: "atmosphere", pattern: /\b(haze|fog|mist|dust|smoke|particle|vapor|atmosphere|atmospheric)\b/i },
  { name: "ground", pattern: /\b(ground|floor|terrain|soil|rock|grass|sand|concrete|stone|surface|gravel)\b/i },
  { name: "scale", pattern: /\b(scale|vast|expansive|stretch|tower|immense|panoramic|sprawling|depth)\b/i },
];
const ENV_COVERAGE_MINIMUM = 3; // 5개 중 3개 이상

// ═══════════════════════════════════════════════════════════════════
// 2. Validator
// ═══════════════════════════════════════════════════════════════════

export function validateFinalProviderPayload(input: ValidatePayloadInput): PayloadValidationResult {
  const issues: PayloadValidationIssue[] = [];
  const sceneType = resolveSceneType(input.shotCategory);

  // ── Rule 1: Positive/Negative duplicate terms ──────────────────
  // "Avoid: ..." 섹션을 제외한 prompt 본문만 검사
  // serializeForProvider가 negative를 embed 한 후 validator가 실행되므로
  // "Avoid:" 이후는 원래 negative → 충돌이 아님
  const promptBodyForConflict = input.prompt.replace(/\.\s*Avoid:\s*.*/i, "");
  const bodyLower = promptBodyForConflict.toLowerCase();

  for (const word of POS_NEG_CRITICAL_WORDS) {
    const wordLower = word.toLowerCase();
    const isInNeg = input.negatives.some(n => n.toLowerCase().includes(wordLower));
    if (!isInNeg) continue;

    // prompt 본문에 해당 단어가 있되, "no X" / "avoid X" / "no text overlay, no X" 패턴 아닌 경우 = 충돌
    if (bodyLower.includes(wordLower)) {
      const guardPattern = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${escapeRegex(word)}\\b`, "i");
      if (!guardPattern.test(promptBodyForConflict)) {
        issues.push({
          rule: "pos_neg_conflict",
          severity: "error",
          message: `"${word}" appears in both prompt and negatives`,
        });
      }
    }
  }

  const promptLower = input.prompt.toLowerCase();

  // ── Rule 2: Environment scene — banned vocabulary ──────────────
  if (sceneType === "environment") {
    for (const pattern of ENV_BANNED_IN_PROMPT) {
      const match = input.prompt.match(pattern);
      if (match) {
        issues.push({
          rule: "env_banned_vocab",
          severity: "error",
          message: `Environment scene contains banned term: "${match[0]}"`,
        });
      }
    }
  }

  // ── Rule 3: Camera framing conflict in prompt text ─────────────
  const framingUpper = input.framing.toUpperCase();
  let declaredCategory: "wide" | "medium" | "close" = "medium";
  if (["WS", "LS", "MLS"].includes(framingUpper)) declaredCategory = "wide";
  else if (["CU", "ECU", "MCU"].includes(framingUpper)) declaredCategory = "close";

  const hasWide = WIDE_TERMS.test(input.prompt);
  const hasMedium = MEDIUM_TERMS.test(input.prompt);
  const hasClose = CLOSE_TERMS.test(input.prompt);
  const framingCount = [hasWide, hasMedium, hasClose].filter(Boolean).length;

  if (framingCount >= 2) {
    issues.push({
      rule: "camera_multi_framing",
      severity: "warning",
      message: `Multiple framing types detected in single shot (wide=${hasWide}, medium=${hasMedium}, close=${hasClose})`,
    });
  }

  // ── Rule 4: Cut-list style fragmented timing ───────────────────
  if (CUT_LIST_WITH_FRAMING.test(input.prompt)) {
    issues.push({
      rule: "temporal_fragmented",
      severity: sceneType === "environment" ? "error" : "warning",
      message: "Cut-list style timing with framing changes detected — should use continuous motion",
    });
  }

  // ── Rule 5: Environment descriptive coverage ───────────────────
  if (sceneType === "environment") {
    const covered = ENV_COVERAGE_CHECKS.filter(c => c.pattern.test(input.prompt)).length;
    if (covered < ENV_COVERAGE_MINIMUM) {
      const missing = ENV_COVERAGE_CHECKS.filter(c => !c.pattern.test(input.prompt)).map(c => c.name);
      issues.push({
        rule: "env_coverage_insufficient",
        severity: "warning",
        message: `Environment descriptive coverage ${covered}/${ENV_COVERAGE_CHECKS.length} (min ${ENV_COVERAGE_MINIMUM}). Missing: ${missing.join(", ")}`,
      });
    }
  }

  // ── Rule 6: Word count check ───────────────────────────────────
  const wordCount = input.prompt.split(/\s+/).length;
  const minWords = sceneType === "environment" ? 60 : sceneType === "map_visualization" ? 40 : 50;
  const maxWords = 300; // Kling word cap

  if (wordCount < minWords) {
    issues.push({
      rule: "word_count_low",
      severity: "warning",
      message: `Word count ${wordCount} below minimum ${minWords} for ${sceneType || "unknown"} scene`,
    });
  }
  if (wordCount > maxWords) {
    issues.push({
      rule: "word_count_high",
      severity: "warning",
      message: `Word count ${wordCount} exceeds ${input.provider} maximum ${maxWords}`,
    });
  }

  // ── Rule 7: Duplicate negatives ────────────────────────────────
  const negSet = new Set<string>();
  const dupNegs: string[] = [];
  for (const n of input.negatives) {
    const key = n.toLowerCase().trim();
    if (negSet.has(key)) dupNegs.push(n);
    else negSet.add(key);
  }
  if (dupNegs.length > 0) {
    issues.push({
      rule: "duplicate_negatives",
      severity: "warning",
      message: `Duplicate negatives: ${dupNegs.join(", ")}`,
    });
  }

  // ── Rule 8: Environment framing check ──────────────────────────
  if (sceneType === "environment" && ["CU", "ECU", "MCU"].includes(framingUpper)) {
    issues.push({
      rule: "env_framing_too_close",
      severity: "error",
      message: `Environment scene with close framing "${input.framing}" — must be WS/LS/MLS`,
    });
  }

  // ── Rule 9: Invalid characterRef ──────────────────────────────
  if (input.characterRef) {
    const charRef = input.characterRef.trim();
    // placeholder/empty check
    if (/^(none|n\/a|unknown|placeholder|default|tbd)$/i.test(charRef)) {
      issues.push({
        rule: "invalid_character_ref",
        severity: "warning",
        message: `Placeholder characterRef: "${charRef}"`,
      });
    }
    // modern generic in historical context
    const isHistorical = /\b(ancient|medieval|dynasty|empire|kingdom|century|era|historical|colonial|wartime|revolution)\b/i.test(input.prompt);
    const isModernGeneric = /\b(casual\s+modern|t[\s-]?shirt|jeans|sneakers|hoodie|baseball\s+cap)\b/i.test(charRef);
    if (isHistorical && isModernGeneric) {
      issues.push({
        rule: "character_ref_era_mismatch",
        severity: "error",
        message: `Modern/generic characterRef in historical scene context`,
      });
    }
    // environment scene with portrait characterRef
    if (sceneType === "environment" && /\b(close[\s-]?up|portrait|head[\s-]?shot|facial)\b/i.test(charRef)) {
      issues.push({
        rule: "character_ref_scene_mismatch",
        severity: "warning",
        message: `Environment scene with close-up/portrait characterRef`,
      });
    }
  }

  // ── Rule 10: Overloaded shot detection ─────────────────────────
  if (input.actionText) {
    const transitionWords = (input.actionText.match(/\b(then|and\s+then|followed\s+by|before|after\s+which|subsequently|next|finally|meanwhile|simultaneously|while|as\s+(?:he|she|they|the))\b/gi) || []).length;
    const maxDensity = sceneType === "environment" ? 1 : sceneType === "crowd" ? 2 : 3;
    if (transitionWords > maxDensity) {
      issues.push({
        rule: "overloaded_shot",
        severity: "warning",
        message: `Action density ${transitionWords} exceeds max ${maxDensity} for ${sceneType || "unknown"} scene — consider splitting shot`,
      });
    }
  }

  // ── Rule 11: Camera-action consistency ─────────────────────────
  if (input.motion && input.actionText) {
    const isStatic = !input.motion || input.motion === "static" || /\bstatic\b/i.test(input.motion);
    const actionStages = (input.actionText.match(/\b(then|and\s+then|followed\s+by|subsequently|next|finally)\b/gi) || []).length;
    if (isStatic && actionStages >= 3) {
      issues.push({
        rule: "camera_action_inconsistent",
        severity: "warning",
        message: `Static camera with ${actionStages} action stages — camera should track or simplify action`,
      });
    }
    // wide shot + micro expressions
    if (["WS", "LS"].includes(framingUpper) && /\b(whisper|murmur|tear\s+rolls?|micro[\s-]?expression|subtle\s+smile)\b/i.test(input.actionText)) {
      issues.push({
        rule: "camera_action_inconsistent",
        severity: "warning",
        message: "Wide framing cannot capture micro-expressions — tighten framing or simplify",
      });
    }
  }

  // ── Rule 12: Scene-type descriptive coverage ───────────────────
  if (sceneType === "character-driven" || sceneType === "person") {
    const charChecks = [
      { name: "age", p: /\b(young|old|elderly|middle[\s-]?aged|teen|child|adult|aged)\b/i },
      { name: "clothing", p: /\b(wearing|dressed|cloth|garment|robe|suit|armor|uniform|tunic|cloak|gown|outfit|coat)\b/i },
      { name: "posture", p: /\b(standing|sitting|kneeling|crouching|leaning|expression|gaze|stare|frown|smile|stern)\b/i },
      { name: "light", p: /\b(light|backlit|sidelit|rim[\s-]?light|shadow|silhouett|illuminat|golden)\b/i },
    ];
    const covered = charChecks.filter(c => c.p.test(input.prompt)).length;
    if (covered < 2) {
      const missing = charChecks.filter(c => !c.p.test(input.prompt)).map(c => c.name);
      issues.push({
        rule: "char_coverage_insufficient",
        severity: "warning",
        message: `Character scene coverage ${covered}/4. Missing: ${missing.join(", ")}`,
      });
    }
  }

  if (sceneType === "crowd") {
    const crowdChecks = [
      { name: "scale", p: /\b(vast|hundreds|thousands|massive|dense|packed|filling)\b/i },
      { name: "movement", p: /\b(march|flow|surge|wave|drift|push|stream|pour|mill|sway|chant|rally)\b/i },
      { name: "env_motion", p: /\b(flag|banner|smoke|dust|confetti|torch|lantern)\b/i },
    ];
    const covered = crowdChecks.filter(c => c.p.test(input.prompt)).length;
    if (covered < 2) {
      const missing = crowdChecks.filter(c => !c.p.test(input.prompt)).map(c => c.name);
      issues.push({
        rule: "crowd_coverage_insufficient",
        severity: "warning",
        message: `Crowd scene coverage ${covered}/3. Missing: ${missing.join(", ")}`,
      });
    }
  }

  // ── Rule 13: Positive keyword coverage ───────────────────────
  if (sceneType) {
    const rule = getSceneTypeRule(sceneType);
    if (rule.positiveKeywords && rule.positiveKeywords.length > 0) {
      const promptAndStyle = promptLower;
      const missing = rule.positiveKeywords.filter(kw => !promptAndStyle.includes(kw.toLowerCase()));
      if (missing.length >= Math.ceil(rule.positiveKeywords.length / 2)) {
        issues.push({
          rule: "positive_keywords_missing",
          severity: "warning",
          message: `Missing ${missing.length}/${rule.positiveKeywords.length} positive keywords for ${sceneType}: ${missing.join(", ")}`,
        });
      }
    }
  }

  // ── Rule 14: Map visualization concrete cues ────────────────
  if (sceneType === "map_visualization") {
    const concreteChecks = [
      { name: "terrain_detail", p: /\b(terrain|elevation|contour|topograph|ridge|plateau|valley|mountain|coast|river|relief)\b/i },
      { name: "lighting", p: /\b(light|shadow|illuminat|glow|ambient)\b/i },
      { name: "atmosphere", p: /\b(haze|atmosphere|fog|mist|depth|ambient)\b/i },
    ];
    const covered = concreteChecks.filter(c => c.p.test(input.prompt)).length;
    if (covered < 2) {
      const missingCues = concreteChecks.filter(c => !c.p.test(input.prompt)).map(c => c.name);
      issues.push({
        rule: "map_concrete_cues_missing",
        severity: "warning",
        message: `Map visualization missing concrete visual cues: ${missingCues.join(", ")} (${covered}/3)`,
      });
    }
    // abstract term check
    if (/\babstract\s+(?:pattern|shape|form|concept)\b/i.test(input.prompt)) {
      issues.push({
        rule: "map_abstract_terms",
        severity: "warning",
        message: "Map visualization contains abstract terms — use concrete visual cues instead",
      });
    }
  }

  // ── Rule 15: MultiShot export validation ───────────────────
  if (input.multiShots && input.multiShots.length > 0) {
    const PROMPT_MAX = 512;
    // 빈 prompt 검사
    const emptyShots = input.multiShots.filter(s => !s.prompt || s.prompt.trim().length === 0);
    if (emptyShots.length > 0) {
      issues.push({
        rule: "multishot_empty_prompt",
        severity: "error",
        message: `MultiShot: 빈 프롬프트 (샷 ${emptyShots.map(s => s.index).join(", ")})`,
      });
    }
    // 개별 prompt 길이
    const overLength = input.multiShots.filter(s => s.prompt && s.prompt.length > PROMPT_MAX);
    if (overLength.length > 0) {
      issues.push({
        rule: "multishot_prompt_too_long",
        severity: "error",
        message: `MultiShot: 프롬프트 ${PROMPT_MAX}자 초과 (샷 ${overLength.map(s => `${s.index}:${s.prompt.length}`).join(", ")})`,
      });
    }
    // duration 합
    if (input.durationSec) {
      const durSum = input.multiShots.reduce((s, sh) => s + (parseInt(sh.duration, 10) || 0), 0);
      if (Math.abs(durSum - input.durationSec) > 1) {
        issues.push({
          rule: "multishot_duration_mismatch",
          severity: "error",
          message: `MultiShot: duration 합 ${durSum}초 ≠ 전체 ${input.durationSec}초`,
        });
      }
    }
    // role 단조로움 경고
    if (input.multiShots.length >= 3) {
      const roles = input.multiShots.map(s => s.role).filter(Boolean);
      if (roles.length > 0 && new Set(roles).size === 1) {
        issues.push({
          rule: "multishot_monotone_role",
          severity: "warning",
          message: `MultiShot: 모든 샷이 같은 역할 (${roles[0]}) — 다양화 권장`,
        });
      }
    }
  }

  const errorCount = issues.filter(i => i.severity === "error").length;
  const autoFixable = issues.some(i =>
    ["pos_neg_conflict", "env_banned_vocab", "camera_multi_framing", "temporal_fragmented", "duplicate_negatives", "env_framing_too_close", "character_ref_era_mismatch", "character_ref_scene_mismatch"].includes(i.rule)
  );

  return {
    valid: errorCount === 0,
    issues,
    autoFixable,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Auto-fix (검증 실패 시 재시도)
// ═══════════════════════════════════════════════════════════════════

/**
 * 검증 실패 항목을 자동 수정 시도.
 * sanitize pipeline을 다시 돌리는 것이 아니라,
 * 최종 문자열 레벨에서 간단한 수정만 수행.
 */
export function autoFixPayload(input: ValidatePayloadInput): {
  prompt: string;
  negatives: string[];
  framing: string;
  fixes: string[];
} {
  const fixes: string[] = [];
  let { prompt, negatives, framing } = input;
  const sceneType = resolveSceneType(input.shotCategory);

  // Fix 1: pos/neg conflicts — "Avoid:" 섹션 분리 후 본문에서만 제거
  const avoidMatch = prompt.match(/(\.\s*Avoid:\s*.*)$/i);
  const avoidSection = avoidMatch ? avoidMatch[1] : "";
  let promptBody = avoidMatch ? prompt.slice(0, prompt.length - avoidSection.length) : prompt;

  for (const word of POS_NEG_CRITICAL_WORDS) {
    const isInNeg = negatives.some(n => n.toLowerCase().includes(word.toLowerCase()));
    if (!isInNeg) continue;
    // Guard: "no watermark", "no text overlay, no watermark" 등 부정 구문 보존
    const guardCheck = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${escapeRegex(word)}\\b`, "i");
    if (guardCheck.test(promptBody)) continue;
    const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    if (pattern.test(promptBody)) {
      promptBody = promptBody.replace(pattern, "").replace(/\s{2,}/g, " ").trim();
      fixes.push(`Removed "${word}" from prompt (conflict with negatives)`);
    }
  }
  prompt = promptBody + avoidSection;

  // Fix 2: env banned vocab
  if (sceneType === "environment") {
    for (const pattern of ENV_BANNED_IN_PROMPT) {
      const match = prompt.match(pattern);
      if (match) {
        prompt = prompt.replace(pattern, "distant figures").replace(/\s{2,}/g, " ").trim();
        fixes.push(`Replaced env-banned "${match[0]}" → "distant figures"`);
      }
    }
  }

  // Fix 3: env framing
  if (sceneType === "environment" && ["CU", "ECU", "MCU"].includes(framing.toUpperCase())) {
    const old = framing;
    framing = "WS";
    fixes.push(`Environment framing "${old}" → "WS"`);
  }

  // Fix 4: duplicate negatives
  const seen = new Set<string>();
  negatives = negatives.filter(n => {
    const key = n.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Cleanup
  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { prompt, negatives, framing, fixes };
}

// ═══════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
