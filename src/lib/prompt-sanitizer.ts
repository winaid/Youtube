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
 * 6. enforcePositiveKeywords (scene-type별 positive 강제)
 */

import {
  type SceneType,
  type EnvironmentSubtype,
  resolveSceneType,
  applySceneTypeVocabularyRules,
  ensureDescriptiveCoverage,
  enforcePositiveKeywords,
  detectEnvironmentSubtype,
  getEnvironmentRequiredElements,
  isPushInMotion,
  detectOutdoorContamination,
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
  environmentType?: string,
): EnvironmentDetailResult {
  const sceneType = resolveSceneType(shotCategory);
  if (!sceneType || (sceneType !== "environment" && sceneType !== "map_visualization")) {
    return { text, additions: [], coverage: { covered: 0, total: 0 } };
  }

  // For environment scenes, use indoor/outdoor-aware elements
  if (sceneType === "environment") {
    const subtype = detectEnvironmentSubtype(text, environmentType);
    const elements = getEnvironmentRequiredElements(subtype);
    const additions: string[] = [];
    let covered = 0;
    for (const { check, fallback } of elements) {
      if (check.test(text)) {
        covered++;
      } else if (fallback) {
        additions.push(fallback);
      }
    }
    if (additions.length === 0) {
      return { text, additions: [], coverage: { covered, total: elements.length } };
    }
    const enriched = text.trim() + ". " + additions.join(", ");
    return {
      text: enriched.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim(),
      additions,
      coverage: { covered, total: elements.length },
    };
  }

  // map_visualization: use generic coverage
  const { additions, coverage, total } = ensureDescriptiveCoverage(text, sceneType);

  if (additions.length === 0) {
    return { text, additions: [], coverage: { covered: coverage, total } };
  }

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
  /** 물리 환경 제약 (structuredSequence.physicsRules) */
  physicsRules?: PhysicsRulesContext;
  /** 씬 타입 (structuredSequence.sceneType) — shotCategory보다 우선 */
  sceneType?: string;
  /** 컷 길이(초) — complexity budget 판단에 사용 */
  durationSec?: number;
  /** editorial persona — persona 충돌 검증에 사용 */
  editorialPersona?: {
    motionBias?: string;
    insertBias?: string;
    preferredCutPace?: [number, number];
  };
}

/** 물리 환경 제약 — sanitizer에서 사용하는 최소 subset */
export interface PhysicsRulesContext {
  hasWind: boolean;
  hasAtmosphere: boolean;
  gravity: string;
  environmentType: string;
  bannedExpressions?: string[];
}

export interface SanitizeIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  autoFixed?: boolean;
}

export interface SanitizePipelineResult {
  prompt: string;
  negatives: string[];
  framing: string;
  log: string[];
  /** 감지된 이슈 목록 */
  issues: SanitizeIssue[];
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
  const issues: SanitizeIssue[] = [];
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

  // 5. Environment detail coverage (indoor/outdoor-aware)
  const envType = input.physicsRules?.environmentType;
  const envResult = ensureEnvironmentDetailCoverage(prompt, input.shotCategory, envType);
  prompt = envResult.text;
  if (envResult.additions.length > 0) {
    log.push(`[env-detail] Added ${envResult.additions.length} missing elements: ${envResult.additions.join(", ")}`);
  }

  // 6. Positive keyword enforcement (scene-type별 필수 positive 추가)
  if (sceneType) {
    const fullText = input.styleSuffix ? `${prompt} ${input.styleSuffix}` : prompt;
    const positiveResult = enforcePositiveKeywords(fullText, sceneType);
    if (positiveResult.additions.length > 0) {
      // pos/neg 충돌이 없는 항목만 추가
      const safeAdditions = positiveResult.additions.filter(kw =>
        !negatives.some(n => n.toLowerCase() === kw.toLowerCase())
      );
      if (safeAdditions.length > 0) {
        prompt = prompt.trim() + ". " + safeAdditions.join(", ");
        log.push(`[positive] Added ${safeAdditions.length} positive keywords: ${safeAdditions.join(", ")}`);
      }
    }
  }

  // 7. Physics-aware sanitization
  const physicsResult = detectPhysicsIssues(prompt, input.physicsRules, input.sceneType || input.shotCategory);
  issues.push(...physicsResult.issues);
  if (physicsResult.fixedPrompt !== prompt) {
    prompt = physicsResult.fixedPrompt;
    log.push(`[physics] Auto-fixed ${physicsResult.issues.filter(i => i.autoFixed).length} physics conflicts`);
  }

  // 8. Scene-aware structural issues
  const structIssues = detectStructuralIssues(prompt, input.sceneType || input.shotCategory, input.physicsRules?.environmentType);
  issues.push(...structIssues);

  // 9. Cut complexity budget
  const complexityIssues = detectCutComplexityIssues(prompt, input.durationSec);
  issues.push(...complexityIssues);
  if (complexityIssues.length > 0) {
    log.push(`[complexity] ${complexityIssues.length} cut complexity issues: ${complexityIssues.map(i => i.rule).join(", ")}`);
  }

  // 9b. Editorial persona conflict detection
  if (input.editorialPersona) {
    const personaIssues = detectEditorialPersonaConflicts(prompt, input.editorialPersona, input.durationSec, input.physicsRules);
    issues.push(...personaIssues);
    if (personaIssues.length > 0) {
      log.push(`[persona] ${personaIssues.length} editorial persona conflicts: ${personaIssues.map(i => i.rule).join(", ")}`);
    }
  }

  // 10. Meta-label stripping — 기획 라벨이 시각 프롬프트에 누출된 경우 제거
  const metaResult = stripMetaLabels(prompt);
  if (metaResult.removed.length > 0) {
    prompt = metaResult.text;
    log.push(`[meta-label] Stripped ${metaResult.removed.length} planning labels: ${metaResult.removed.join(", ")}`);
    if (metaResult.wasDominated) {
      issues.push({
        rule: "meta_label_dominated_prompt",
        severity: "error",
        message: "Prompt was dominated by planning/editorial labels — no concrete visual content",
      });
    }
  }

  // 11. Malformed Korean detection
  const malformed = detectMalformedKorean(prompt);
  if (malformed.length > 0) {
    issues.push({
      rule: "malformed_korean_particles",
      severity: "error",
      message: `Malformed Korean particle combinations detected: ${malformed.join(", ")}`,
    });
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
    issues,
    clean: log.length === 0 && issues.filter(i => i.severity === "error").length === 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 7. Physics-Aware Sanitization
// ═══════════════════════════════════════════════════════════════════

/** 환경 물리 제약에 기반한 프롬프트 충돌 감지 및 auto-fix */
export function detectPhysicsIssues(
  prompt: string,
  physicsRules?: PhysicsRulesContext,
  sceneTypeOrCategory?: string,
): { issues: SanitizeIssue[]; fixedPrompt: string } {
  const issues: SanitizeIssue[] = [];
  let fixed = prompt;

  if (!physicsRules) return { issues, fixedPrompt: fixed };

  const lower = fixed.toLowerCase();

  // ── No-wind environment: flutter/wave/blow 충돌 감지 ──
  if (!physicsRules.hasWind) {
    const windMotionPatterns = [
      { pattern: /\bflutter(?:ing|s)?\s+in\s+(?:the\s+)?wind\b/gi, fix: "hanging motionless" },
      { pattern: /\bblow(?:ing|s|n)?\s+in\s+(?:the\s+)?(?:wind|breeze)\b/gi, fix: "hanging still" },
      { pattern: /\bwave(?:s|ing)?\s+in\s+(?:the\s+)?(?:wind|breeze)\b/gi, fix: "rigid and still" },
      { pattern: /\bwind[\s-]?blown\b/gi, fix: "motionless" },
      { pattern: /\bbreeze[\s-]?(?:blown|swept|ruffled)\b/gi, fix: "still" },
      { pattern: /\brippl(?:ing|es?)\s+(?:in\s+)?(?:the\s+)?(?:wind|breeze|air)\b/gi, fix: "motionless" },
    ];

    for (const { pattern, fix } of windMotionPatterns) {
      const before = fixed;
      fixed = fixed.replace(pattern, fix);
      if (fixed !== before) {
        issues.push({
          rule: "physics_flag_wind_conflict",
          severity: "error",
          message: `Wind-dependent motion in no-wind environment (${physicsRules.environmentType}): replaced with "${fix}"`,
          autoFixed: true,
        });
      }
    }
  }

  // ── No-atmosphere environment: atmospheric effects 충돌 ──
  if (!physicsRules.hasAtmosphere) {
    const atmoPatterns = [
      { pattern: /\batmospheric\s+(?:haze|fog|mist|flutter)\b/gi, fix: "stark vacuum clarity" },
      { pattern: /\b(?:haze|fog|mist)\s+(?:drifts?|fills?|settles?|rolls?)\b/gi, fix: "clear void" },
      { pattern: /\bair\s+(?:shimmers?|ripples?|distort)\b/gi, fix: "vacuum stillness" },
    ];

    for (const { pattern, fix } of atmoPatterns) {
      const before = fixed;
      fixed = fixed.replace(pattern, fix);
      if (fixed !== before) {
        issues.push({
          rule: "physics_motion_environment_conflict",
          severity: "error",
          message: `Atmospheric effect in vacuum environment: replaced with "${fix}"`,
          autoFixed: true,
        });
      }
    }
  }

  // ── Low/zero gravity: falling/dropping 충돌 ──
  if (physicsRules.gravity === "low" || physicsRules.gravity === "zero") {
    const gravityPatterns = [
      { pattern: /\b(?:falls?|falling)\s+(?:quickly|rapidly|fast|heavily)\b/gi, fix: physicsRules.gravity === "zero" ? "drifts slowly" : "settles gradually" },
      { pattern: /\bcrash(?:es|ing)?\s+(?:to|into)\s+(?:the\s+)?(?:ground|floor|surface)\b/gi, fix: "drifts toward the surface" },
    ];

    for (const { pattern, fix } of gravityPatterns) {
      const before = fixed;
      fixed = fixed.replace(pattern, fix);
      if (fixed !== before) {
        issues.push({
          rule: "physics_motion_environment_conflict",
          severity: "warning",
          message: `Rapid falling in ${physicsRules.gravity}-gravity environment: replaced with "${fix}"`,
          autoFixed: true,
        });
      }
    }
  }

  // ── bannedExpressions from physicsRules ──
  if (physicsRules.bannedExpressions) {
    for (const banned of physicsRules.bannedExpressions) {
      const banRe = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      const before = fixed;
      fixed = fixed.replace(banRe, "");
      if (fixed !== before) {
        issues.push({
          rule: "physics_motion_environment_conflict",
          severity: "error",
          message: `Banned expression "${banned}" removed (physics constraint: ${physicsRules.environmentType})`,
          autoFixed: true,
        });
      }
    }
  }

  return { issues, fixedPrompt: fixed };
}

// ═══════════════════════════════════════════════════════════════════
// 8. Structural Issue Detection
// ═══════════════════════════════════════════════════════════════════

/** 장면 구조 문제 감지 — auto-fix는 하지 않고 issue로만 보고 */
export function detectStructuralIssues(
  prompt: string,
  sceneTypeOrCategory?: string,
  environmentType?: string,
): SanitizeIssue[] {
  const issues: SanitizeIssue[] = [];
  const lower = prompt.toLowerCase();

  // ── Discrete shot type sequence in single generation ──
  // "Wide shot → Medium shot → Close-up" 같은 나열 감지
  const discreteShotTypes = [
    /\bwide\b/i, /\bmedium\b/i, /\bclose[\s-]?up\b/i,
    /\bWS\b/, /\bMS\b/, /\bCU\b/, /\bLS\b/, /\bECU\b/,
  ];
  const matchedFramings = discreteShotTypes.filter(p => p.test(prompt));
  if (matchedFramings.length >= 3) {
    issues.push({
      rule: "discrete_shot_sequence_in_single_generation",
      severity: "warning",
      message: `${matchedFramings.length} different shot types detected in single prompt — may cause incoherent generation`,
    });
  }

  // ── Missing continuous camera bridge ──
  // "cut to" 사용 시 연속 카메라 브릿지 부족
  if (/\bcut\s+to\b/i.test(prompt) && !/\bcontinuous\b/i.test(prompt) && !/\bwithout\s+(?:a\s+)?cut/i.test(prompt)) {
    issues.push({
      rule: "missing_continuous_camera_bridge",
      severity: "warning",
      message: "Explicit 'cut to' in prompt — consider continuous camera movement for single-generation video",
    });
  }

  // ── Environment scene specific ──
  const resolvedType = resolveSceneType(sceneTypeOrCategory);
  if (resolvedType === "environment") {
    // Missing location identity anchor
    const locationPatterns = /\b(desk|chair|stove|clinic|office|restaurant|street|car|bed|lobby|warehouse|factory|bench|fountain|monument|statue|bridge|tower|dock|pier|lighthouse|temple|ruins|crater|flag|pole|landing\s+site)\b/i;
    if (!locationPatterns.test(prompt)) {
      issues.push({
        rule: "missing_location_identity_anchor",
        severity: "warning",
        message: "Environment scene lacks specific location-identity objects — add recognizable anchors",
      });
    }

    // Missing natural motion for environment
    const motionPatterns = /\b(sway|drift|ripple|flutter|rustle|shimmer|flow|wave|settle|spin|dust|particle|cloud\s+move|light\s+shift)\b/i;
    if (!motionPatterns.test(prompt)) {
      issues.push({
        rule: "missing_natural_motion_for_environment",
        severity: "warning",
        message: "Environment scene has no natural motion cues — add wind/water/light/particle motion",
      });
    }

    // ── NEW: Camera motion monotony (push-in convergence) ──
    const cameraMotionMatches = prompt.match(/\b(push[\s-]?in|dolly[\s-]?in|zoom[\s-]?in|move\s+(?:slowly\s+)?(?:toward|forward|closer))\b/gi) || [];
    if (cameraMotionMatches.length >= 1) {
      // Check if push-in is the ONLY motion mentioned
      const hasOtherMotion = /\b(pan|orbit|crane|drift|tracking|pull[\s-]?back|sweep|flyover|lateral|dolly\s+(?:through|along|around)|float)\b/i.test(prompt);
      if (!hasOtherMotion) {
        issues.push({
          rule: "environment_camera_monotony",
          severity: "warning",
          message: "Environment scene uses only push-in camera motion — consider pan, orbit, crane, drift, or tracking for variety",
        });
      }
    }

    // ── NEW: Indoor/outdoor contamination ──
    const subtype = detectEnvironmentSubtype(prompt, environmentType);
    if (subtype === "indoor") {
      const contaminants = detectOutdoorContamination(prompt);
      if (contaminants.length > 0) {
        issues.push({
          rule: "indoor_outdoor_contamination",
          severity: "warning",
          message: `Indoor environment has outdoor elements: ${contaminants.join(", ")} — remove or replace with indoor equivalents`,
        });
      }
    }

    // ── NEW: Temporal beats as distance escalation ──
    const beatSegments = prompt.match(/\d+s[-–]\d+s\s*:?\s*[^.]+/g) || [];
    if (beatSegments.length >= 2) {
      const distanceWords = /\b(closer|nearer|approach|zoom\s+in|push\s+in|tighter|move\s+toward|dolly\s+in)\b/i;
      const distanceBeats = beatSegments.filter(b => distanceWords.test(b));
      if (distanceBeats.length >= 2) {
        issues.push({
          rule: "temporal_beats_distance_escalation",
          severity: "warning",
          message: "Temporal beats describe distance escalation (closer/nearer/approach) — render as environmental progression (light change, activity shift, atmosphere evolution) instead",
        });
      }
    }

    // ── NEW: Missing environmental progression ──
    const progressionCues = /\b(shift|change|transition|evolve|deepen|brighten|darken|warm|cool|intensif|fade|grow|diminish|spread|recede|gather|scatter|settle|clear|thicken|thin)\b/i;
    if (!progressionCues.test(prompt) && prompt.split(/\s+/).length > 30) {
      issues.push({
        rule: "environment_missing_progression",
        severity: "warning",
        message: "Environment scene has no environmental progression — add light/weather/activity changes over time",
      });
    }
  }

  // ── Insufficient temporal beats ──
  const beatMatches = prompt.match(/\d+s[-–]\d+s/g) || [];
  if (beatMatches.length === 0 && !/\bfirst\b.*\bthen\b/i.test(prompt) && prompt.split(/\s+/).length > 40) {
    issues.push({
      rule: "insufficient_temporal_beats",
      severity: "warning",
      message: "Long prompt with no temporal structure (no time beats or first/then progression)",
    });
  }

  // ── Abstract symbolism over specific visuals ──
  const abstractPatterns = /\b(symboliz(?:ing|es?)|represent(?:ing|s)|evok(?:ing|es?)|metaphor(?:ically)?|allegory|embod(?:ying|ies?))\b/gi;
  const abstractMatches = prompt.match(abstractPatterns) || [];
  if (abstractMatches.length >= 2) {
    issues.push({
      rule: "abstract_symbolism_over_specific_visuals",
      severity: "warning",
      message: `${abstractMatches.length} abstract/symbolic phrases detected — ensure physical/visual descriptions dominate`,
    });
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// 9. Cut Complexity Budget
// ═══════════════════════════════════════════════════════════════════

/**
 * 컷 복잡도 예산 검사.
 * 규칙: 1 primary subject, 1 action, 1 camera motion, 1-2 temporal beats per cut.
 *
 * 감지 이슈:
 * - cut_overstuffed: 전반적으로 과적재
 * - too_many_subjects: 주체 2개 이상
 * - multiple_actions: 동작 2개 이상
 * - excessive_temporal: temporal beat 3개 이상
 * - symbolism_overriding: 상징/은유가 시각 묘사를 압도
 * - camera_overload: 카메라 모션 지시 2개 이상
 */
export function detectCutComplexityIssues(
  prompt: string,
  durationSec?: number,
): SanitizeIssue[] {
  const issues: SanitizeIssue[] = [];

  // ── Subject count: 명확한 인물/주체 묘사 패턴 ──
  const subjectPatterns = /\b(a\s+(?:man|woman|figure|person|child|soldier|warrior|king|queen|monk|priest|doctor|worker)|(?:two|three|four|five|several|multiple)\s+(?:people|men|women|figures|soldiers|warriors))\b/gi;
  const subjectMatches = prompt.match(subjectPatterns) || [];
  const multipleSubjectCue = /\b(two|three|four|five|several|multiple|group\s+of|crowd\s+of|pair\s+of)\b/i;
  if (subjectMatches.length >= 2 || multipleSubjectCue.test(prompt)) {
    issues.push({
      rule: "too_many_subjects",
      severity: "warning",
      message: "Multiple subjects detected in single cut — prefer 1 primary subject per cut",
    });
  }

  // ── Action count: 동작 동사 밀도 ──
  const actionVerbs = /\b(walks?|runs?|jumps?|falls?|turns?|grabs?|throws?|kicks?|hits?|lifts?|pushes?|pulls?|climbs?|crawls?|fights?|draws?|swings?|fires?|dances?|spins?|leaps?|dives?|slams?|charges?|retreats?|collapses?|rises?|kneels?|bows?|strikes?|blocks?|dodges?|shoots?|stabs?)\b/gi;
  const actionMatches = prompt.match(actionVerbs) || [];
  if (actionMatches.length >= 3) {
    issues.push({
      rule: "multiple_actions",
      severity: "warning",
      message: `${actionMatches.length} action verbs in single cut — prefer 1 primary action per cut`,
    });
  }

  // ── Camera motion count ──
  const cameraMotions = /\b(push[\s-]?in|pull[\s-]?back|pan\s+(?:left|right)|tilt\s+(?:up|down)|dolly|track(?:ing)?|crane\s+(?:up|down)|orbit|zoom\s+(?:in|out)|handheld|steadicam|jib|flyover|whip\s+pan|rack\s+focus|sweep)\b/gi;
  const cameraMatches = prompt.match(cameraMotions) || [];
  if (cameraMatches.length >= 3) {
    issues.push({
      rule: "camera_overload",
      severity: "warning",
      message: `${cameraMatches.length} camera motions in single cut — prefer 1 camera motion directive per cut`,
    });
  }

  // ── Temporal beat count ──
  const beatSegments = prompt.match(/\d+s?\s*[-–]\s*\d+s?\s*:/g) || [];
  const maxBeats = (durationSec && durationSec <= 4) ? 2 : 3;
  if (beatSegments.length > maxBeats) {
    issues.push({
      rule: "excessive_temporal",
      severity: "warning",
      message: `${beatSegments.length} temporal beats in ${durationSec || "unknown"}s cut — max ${maxBeats} recommended`,
    });
  }

  // ── Symbolism overriding visuals ──
  const symbolismPatterns = /\b(symboliz(?:ing|es?)|represent(?:ing|s)|evok(?:ing|es?)|metaphor(?:ically)?|allegory|embod(?:ying|ies?)|signif(?:ying|ies?))\b/gi;
  const symbolismMatches = prompt.match(symbolismPatterns) || [];
  const wordCount = prompt.split(/\s+/).length;
  if (symbolismMatches.length >= 2 && symbolismMatches.length / wordCount > 0.02) {
    issues.push({
      rule: "symbolism_overriding",
      severity: "warning",
      message: `${symbolismMatches.length} symbolism/metaphor phrases — ensure concrete visual descriptions dominate over abstract symbolism`,
    });
  }

  // ── Overall overstuffed check ──
  const totalIndicators = subjectMatches.length + actionMatches.length + cameraMatches.length + beatSegments.length;
  const densityThreshold = (durationSec && durationSec <= 4) ? 6 : 8;
  if (totalIndicators > densityThreshold) {
    issues.push({
      rule: "cut_overstuffed",
      severity: "warning",
      message: `Cut complexity score ${totalIndicators}/${densityThreshold} — reduce subjects, actions, camera moves, or temporal beats`,
    });
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// Editorial Persona Conflict Detection
// ═══════════════════════════════════════════════════════════════════

/**
 * Editorial persona가 cut complexity budget / physics constraints와
 * 충돌하는 경우를 감지한다.
 */
export function detectEditorialPersonaConflicts(
  prompt: string,
  persona: {
    motionBias?: string;
    insertBias?: string;
    preferredCutPace?: [number, number];
  },
  durationSec?: number,
  physicsRules?: PhysicsRulesContext,
): SanitizeIssue[] {
  const issues: SanitizeIssue[] = [];

  // 1. persona_conflicts_with_cut_complexity_budget
  // persona가 high insert / frenetic motion인데 cut이 이미 overstuffed이면 경고
  const cameraMotions = (prompt.match(/\b(push[\s-]?in|pull[\s-]?back|pan\s+(?:left|right)|tilt\s+(?:up|down)|dolly|track(?:ing)?|crane|orbit|zoom|handheld|steadicam|jib|flyover|whip\s+pan|rack\s+focus|sweep)\b/gi) || []).length;
  const actionVerbs = (prompt.match(/\b(walks?|runs?|jumps?|falls?|turns?|grabs?|throws?|kicks?|hits?|lifts?|pushes?|pulls?|climbs?|fights?|swings?|fires?|dances?|spins?|leaps?)\b/gi) || []).length;
  const totalComplexity = cameraMotions + actionVerbs;
  const threshold = (durationSec && durationSec <= 4) ? 4 : 6;

  if (totalComplexity > threshold && (persona.motionBias === "frenetic" || persona.motionBias === "dynamic")) {
    issues.push({
      rule: "persona_conflicts_with_cut_complexity_budget",
      severity: "warning",
      message: `${persona.motionBias} motion bias + ${totalComplexity} complexity indicators exceeds budget for ${durationSec || "unknown"}s cut`,
    });
  }

  // 2. persona_overdrives_insert_frequency
  // high insert bias인데 insert/detail 패턴이 동일 프롬프트 안에서 과다
  if (persona.insertBias === "high") {
    const insertPatterns = (prompt.match(/\b(insert|detail|close[\s-]?up|macro|texture|surface|shadow|silhouette)\b/gi) || []).length;
    if (insertPatterns >= 4) {
      issues.push({
        rule: "persona_overdrives_insert_frequency",
        severity: "warning",
        message: `high insert bias + ${insertPatterns} insert/detail cues in single cut — risk of overstuffing`,
      });
    }
  }

  // 3. persona_forces_excessive_temporal_progression
  // measured/slow pace persona인데 2s 이하 컷에 2+ beats 있으면 충돌
  if (persona.preferredCutPace && persona.preferredCutPace[0] >= 5) {
    const beatSegments = (prompt.match(/\d+s?\s*[-–]\s*\d+s?\s*:/g) || []).length;
    if (durationSec && durationSec <= 3 && beatSegments >= 2) {
      issues.push({
        rule: "persona_forces_excessive_temporal_progression",
        severity: "warning",
        message: `slow pace persona (${persona.preferredCutPace[0]}-${persona.preferredCutPace[1]}s) but ${beatSegments} beats in ${durationSec}s cut`,
      });
    }
  }

  // 4. persona_motion_bias_conflicts_with_scene_constraints
  // dynamic/frenetic motion bias인데 no-wind 환경이면 충돌 가능
  if (physicsRules && !physicsRules.hasWind && (persona.motionBias === "frenetic" || persona.motionBias === "dynamic")) {
    const windMotion = /\b(flutter|wave|blow|ripple|billow|sway)\b/i.test(prompt);
    if (windMotion) {
      issues.push({
        rule: "persona_motion_bias_conflicts_with_scene_constraints",
        severity: "warning",
        message: `${persona.motionBias} motion bias produced wind-dependent motion in ${physicsRules.environmentType} environment`,
      });
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// 10. Meta-Label / Planning Label Sanitizer
// ═══════════════════════════════════════════════════════════════════

/**
 * 기획/편집 메타 라벨이 시각 프롬프트 필드에 누출되었는지 감지하고 제거.
 *
 * 이런 문구들은 planning-only이며 provider-facing 프롬프트에 절대 들어가면 안 됨:
 * - "[달에과 제일 — 강렬한 도입]"
 * - "강렬한 도입", "질문, 도발, 또는 약속"
 * - shot role labels: 도입 / 전개 / 절정 / 마무리
 * - beat descriptors: 핵심 메커니즘, 논리적 클라이맥스, 충격적 이미지
 */

/** 대괄호로 감싼 메타 라벨 (예: [달에과 제일 — 강렬한 도입]) */
const BRACKETED_META_PATTERN = /\[[^\]]*(?:도입|전개|절정|마무리|삽입|전환|훅|hook|setup|mechanism|reveal|payoff|escalation|paradox|consequence|transition)[^\]]*\]/gi;

/** 단독 출현 시 planning label인 한국어 구문 */
const KOREAN_META_PHRASES = [
  "강렬한 도입",
  "시청자의 스크롤을 멈추는",
  "질문, 도발, 또는 약속",
  "질문, 도발, 약속",
  "논리적 클라이맥스",
  "핵심 메커니즘",
  "충격적 이미지",
  "텐션 상승",
  "감정적 보상",
  "시각적 보상",
  "시점 전환",
  "정보 축적",
  "서사 전개",
  "스크롤 멈춤",
  "인지적 보상",
  "감정적 여운",
  "호기심 유발",
  "시선 포착",
];

/** shot role labels — 단독 또는 슬래시 구분 나열 시 */
const ROLE_LABEL_PATTERN = /(?:^|\s)(?:도입|전개|삽입|절정|마무리|전환)\s*[/·]\s*(?:도입|전개|삽입|절정|마무리|전환)(?:\s*[/·]\s*(?:도입|전개|삽입|절정|마무리|전환))*/g;

/** em-dash 뒤에 오는 한국어 planning suffix 패턴 */
const EMDASH_META_SUFFIX = /\s*[—–]\s*(?:강렬한 도입|배경 설정|핵심 원리|핵심 전개|숨겨진 진실|결과와 영향|텐션 상승|역설적 결론|최종 의미|시점 전환)/g;

export interface MetaLabelSanitizeResult {
  text: string;
  removed: string[];
  /** true if the text was dominated by meta labels (>50% removed) */
  wasDominated: boolean;
}

/**
 * 시각 프롬프트 텍스트에서 기획 메타 라벨을 제거.
 * 제거 후 빈 문자열이 되면 wasDominated=true.
 */
export function stripMetaLabels(text: string): MetaLabelSanitizeResult {
  const removed: string[] = [];
  let cleaned = text;
  const originalLength = text.trim().length;

  // 1. 대괄호 메타 라벨 제거
  cleaned = cleaned.replace(BRACKETED_META_PATTERN, (match) => {
    removed.push(match);
    return "";
  });

  // 2. em-dash planning suffix 제거
  cleaned = cleaned.replace(EMDASH_META_SUFFIX, (match) => {
    removed.push(match.trim());
    return "";
  });

  // 3. 한국어 메타 구문 제거
  for (const phrase of KOREAN_META_PHRASES) {
    const pattern = new RegExp(escapeRegex(phrase), "g");
    cleaned = cleaned.replace(pattern, (match) => {
      removed.push(match);
      return "";
    });
  }

  // 4. role label 슬래시 나열 제거 (도입 / 전개 / 삽입 / 절정 / 마무리)
  cleaned = cleaned.replace(ROLE_LABEL_PATTERN, (match) => {
    removed.push(match.trim());
    return "";
  });

  // 정리
  cleaned = cleaned
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[—–,.\s]+/, "")
    .replace(/[—–,.\s]+\s*$/, "")
    .trim();

  const wasDominated = originalLength > 0 && cleaned.length < originalLength * 0.5;

  return { text: cleaned, removed, wasDominated };
}

/**
 * 시각 프롬프트 필드의 의미론적 유효성 검증.
 *
 * 각 필드가 해당 역할에 맞는 내용인지 확인:
 * - subject.primary: 가시적 주체여야 함 (마케팅 문구 X)
 * - environment: 장소 묘사여야 함 (hook label X)
 * - moodLighting: 실제 광원/방향/품질이어야 함 (감정 카피 X)
 * - action: 가시적 신체 동작이어야 함 (추상 서사 목적 X)
 */
export interface SemanticFieldIssue {
  field: string;
  value: string;
  reason: string;
}

export function validateSemanticFields(fields: {
  subject?: string;
  environment?: string;
  moodLighting?: string;
  action?: string;
}): SemanticFieldIssue[] {
  const issues: SemanticFieldIssue[] = [];

  // subject: 한국어 기획 라벨이면 reject
  if (fields.subject) {
    const stripped = stripMetaLabels(fields.subject);
    if (stripped.wasDominated || stripped.text.length < 3) {
      issues.push({
        field: "subject",
        value: fields.subject,
        reason: "subject is a planning label, not a visible subject description",
      });
    }
  }

  // environment: 기획 라벨이면 reject
  if (fields.environment) {
    const stripped = stripMetaLabels(fields.environment);
    if (stripped.wasDominated || stripped.text.length < 3) {
      issues.push({
        field: "environment",
        value: fields.environment,
        reason: "environment is a planning label, not a place description",
      });
    }
  }

  // moodLighting: 감정 카피만 있고 광원 묘사 없으면 경고
  if (fields.moodLighting) {
    const stripped = stripMetaLabels(fields.moodLighting);
    if (stripped.wasDominated) {
      issues.push({
        field: "moodLighting",
        value: fields.moodLighting,
        reason: "moodLighting contains planning labels instead of actual lighting description",
      });
    }
  }

  return issues;
}

/**
 * 말이 안 되는 한국어 조합 감지.
 * "달에과 제일" 같은 조사 중복/잘못된 결합을 탐지.
 */
const MALFORMED_PARTICLE_PATTERNS = [
  // 조사 + 조사 연결 (에과, 에와, 에는, 의과, 를과, 을와, 에서과 등)
  /[가-힣]+[에의로서][과와]/,
  // 이중 조사 나열 (은는, 이가, 을를)
  /[가-힣]+[은는][은는]/,
  /[가-힣]+[이가][이가]/,
  /[가-힣]+[을를][을를]/,
];

export function detectMalformedKorean(text: string): string[] {
  const issues: string[] = [];
  for (const pattern of MALFORMED_PARTICLE_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, "g"));
    if (matches) {
      issues.push(...matches);
    }
  }
  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
