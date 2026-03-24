/**
 * gemini-quality-check.ts — Gemini QA / Validation / Auto-fix 전용 모듈
 *
 * 역할:
 *  - structuredSequence 품질 검사 (pos/neg conflict, sceneType, anchors, physics)
 *  - quality score + actionable suggestions
 *  - auto-fix / rewrite / normalization
 *
 * Gemini는 video generation provider가 아니라 QA/normalization provider다.
 * 생성은 VEO가 담당한다.
 *
 * 파이프라인 위치:
 *   build raw structuredSequence
 *   → gemini QA 검사 (이 모듈)
 *   → auto-fix / normalize
 *   → normalized structuredSequence 확정
 *   → VEO generate
 */

import type { StructuredSequenceDocument, PhysicsRules } from "@/types";
import { detectPhysicsRules, checkPhysicsConsistency } from "@/lib/physics-rules";
import { validateSequenceDensity } from "@/lib/shot-splitting";
import { MULTI_SHOT_SCENE_TYPES } from "@/lib/multi-shot-scene-types";
import { CRITICAL_CONFLICT_WORDS } from "@/lib/critical-words";

// ═══════════════════════════════════════════════════════════════════
// 1. Quality Check Result Types
// ═══════════════════════════════════════════════════════════════════

export interface QualityCheckIssue {
  category:
    | "pos_neg_conflict"
    | "sceneType"
    | "environment"
    | "character"
    | "map"
    | "lunar"
    | "physics"
    | "anchors"
    | "motion"
    | "light"
    | "shot_splitting"
    | "density"
    | "general";
  severity: "error" | "warning" | "info";
  message: string;
  autoFixable: boolean;
  suggestedFix?: string;
}

export interface QualityCheckResult {
  valid: boolean;
  score: number; // 0-100
  issues: QualityCheckIssue[];
  suggestions: string[];
  /** 자동 수정이 필요한 항목 수 */
  autoFixCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// 2. Preflight Quality Check — structuredSequence 사전 검사
// ═══════════════════════════════════════════════════════════════════

/**
 * structuredSequence가 VEO 생성 전에 충분한 품질인지 검사.
 * Gemini API 호출 없이 규칙 기반으로 동작 (로컬 fast-path).
 *
 * Gemini API 기반 심층 검사는 preflightWithGemini()로 분리.
 */
export function preflightQualityCheck(
  seq: StructuredSequenceDocument,
): QualityCheckResult {
  const issues: QualityCheckIssue[] = [];
  const suggestions: string[] = [];

  // ── 1. pos/neg conflict 검사 ──────────────────────────────────
  if (seq.negatives && seq.shotPlan) {
    const allNeg = [
      ...seq.negatives.universal,
      ...seq.negatives.sceneSpecific,
      ...seq.negatives.failureMode,
      ...seq.negatives.user,
    ];
    const promptText = [
      seq.shotPlan.subject.primary,
      seq.shotPlan.action,
      seq.shotPlan.environment,
      seq.shotPlan.moodLighting,
    ].join(" ").toLowerCase();

    for (const word of CRITICAL_CONFLICT_WORDS) {
      const inNeg = allNeg.some(n => n.toLowerCase().includes(word));
      if (inNeg && promptText.includes(word)) {
        const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${word}\\b`, "i");
        if (!guardRe.test(promptText)) {
          issues.push({
            category: "pos_neg_conflict",
            severity: "error",
            message: `"${word}" in both prompt and negatives`,
            autoFixable: true,
            suggestedFix: `Remove "${word}" from prompt body`,
          });
        }
      }
    }
  }

  // ── 2. sceneType 검사 ─────────────────────────────────────────
  if (!seq.sceneType || seq.sceneType === "unknown") {
    issues.push({
      category: "sceneType",
      severity: "warning",
      message: "sceneType not set or unknown",
      autoFixable: true,
      suggestedFix: "Infer sceneType from shotPlan content",
    });
  }

  // ── 3. WHERE anchors 검사 ─────────────────────────────────────
  if (!seq.placeIdentityAnchors || seq.placeIdentityAnchors.length === 0) {
    issues.push({
      category: "anchors",
      severity: "error",
      message: "No placeIdentityAnchors (WHERE) — minimum 1 required",
      autoFixable: true,
      suggestedFix: "Extract location cues from environment field",
    });
  }

  // ── 4. WHAT evidence 검사 ─────────────────────────────────────
  if (!seq.situationEvidence || seq.situationEvidence.length === 0) {
    issues.push({
      category: "anchors",
      severity: "error",
      message: "No situationEvidence (WHAT) — minimum 1 required",
      autoFixable: true,
      suggestedFix: "Extract situation cues from action field",
    });
  }

  // ── 5. natural motion 검사 ────────────────────────────────────
  if (!seq.naturalMotion || seq.naturalMotion.length === 0) {
    issues.push({
      category: "motion",
      severity: "warning",
      message: "No naturalMotion descriptors",
      autoFixable: false,
    });
  }

  // ── 6. explicit light source 검사 ─────────────────────────────
  const lightText = seq.shotPlan?.moodLighting || "";
  const hasExplicitLight = /\b(sunlight|moonlight|lamplight|candlelight|firelight|neon|fluorescent|backlit|sidelit|overhead|golden\s+hour|blue\s+hour|rim\s+light)\b/i.test(lightText);
  if (!hasExplicitLight) {
    issues.push({
      category: "light",
      severity: "warning",
      message: "No explicit light source in moodLighting",
      autoFixable: false,
      suggestedFix: "Add specific light source (e.g., 'harsh sunlight', 'warm lamplight')",
    });
  }

  // ── 7. physics violation 검사 ─────────────────────────────────
  if (seq.physicsRules && seq.shotPlan) {
    // Extract string fields from shotPlan for physics checking
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(seq.shotPlan)) {
      if (typeof v === "string") fields[k] = v;
    }
    const physicsCheck = checkPhysicsConsistency(seq.physicsRules, fields);
    for (const violation of physicsCheck) {
      issues.push({
        category: "physics",
        severity: "error",
        message: violation.message,
        autoFixable: true,
        suggestedFix: "Apply physics-aware rewrite",
      });
    }
  }

  // ── 8. shot splitting 필요 여부 ───────────────────────────────
  if (MULTI_SHOT_SCENE_TYPES.has(seq.sceneType) && (!seq.shots || seq.shots.length < 2)) {
    if (seq.durationSec > 3) {
      issues.push({
        category: "shot_splitting",
        severity: "warning",
        message: `${seq.sceneType} scene should have 2+ shots but has ${seq.shots?.length ?? 0}`,
        autoFixable: true,
        suggestedFix: "Auto-split into 2-3 shots using scene-type templates",
      });
    }
  }

  // ── 9. temporal beats 검사 ────────────────────────────────────
  if (!seq.temporalBeats || seq.temporalBeats.length < 2) {
    issues.push({
      category: "density",
      severity: "warning",
      message: `Only ${seq.temporalBeats?.length ?? 0} temporal beats — minimum 2 required`,
      autoFixable: true,
    });
  }

  // ── 10. density score 검사 ────────────────────────────────────
  if (seq.densityScore && seq.densityScore.total < 50) {
    issues.push({
      category: "density",
      severity: "warning",
      message: `Density score ${seq.densityScore.total}/100 — below minimum 50`,
      autoFixable: false,
      suggestedFix: `Missing: ${seq.densityScore.missing.join(", ")}`,
    });
    suggestions.push(`Improve density: add ${seq.densityScore.missing.join(", ")}`);
  }

  // ── 11. environment-specific rules ────────────────────────────
  if (seq.sceneType === "environment") {
    const framing = seq.shotPlan?.camera?.framing?.toUpperCase();
    if (framing && ["CU", "ECU", "MCU"].includes(framing)) {
      issues.push({
        category: "environment",
        severity: "error",
        message: `Environment scene with close framing "${framing}" — must be WS/LS/MLS`,
        autoFixable: true,
        suggestedFix: "Change framing to WS",
      });
    }
  }

  // ── 12. map scene rules ──────────────────────────────────────
  if (seq.sceneType === "map-graphic" || seq.sceneType === "map_visualization") {
    const framing = seq.shotPlan?.camera?.framing?.toUpperCase();
    if (framing && !["WS", "LS", "MLS"].includes(framing)) {
      issues.push({
        category: "map",
        severity: "error",
        message: `Map scene with non-wide framing "${framing}" — must be WS/LS/MLS`,
        autoFixable: true,
        suggestedFix: "Change framing to WS",
      });
    }
    const angle = seq.shotPlan?.camera?.angle?.toLowerCase();
    if (angle && angle !== "overhead" && angle !== "high_angle") {
      issues.push({
        category: "map",
        severity: "warning",
        message: `Map scene with non-overhead angle "${angle}" — should be overhead`,
        autoFixable: true,
        suggestedFix: "Change angle to overhead",
      });
    }
  }

  // ── 13. character scene rules ───────────────────────────────
  if (seq.sceneType === "character-driven" || seq.sceneType === "character") {
    if (!seq.shotPlan?.subject?.characterRef) {
      issues.push({
        category: "character",
        severity: "error",
        message: "Character scene missing characterRef — required for consistency",
        autoFixable: true,
        suggestedFix: "Auto-fill characterRef from primary subject",
      });
    }
  }

  // ── 14. lunar/space rules ─────────────────────────────────────
  if (seq.physicsRules?.environmentType === "lunar" || seq.physicsRules?.environmentType === "space") {
    const allText = JSON.stringify(seq.shotPlan).toLowerCase();
    const LUNAR_BANNED = ["wind", "breeze", "overcast", "clouds", "rain", "fog", "haze", "atmospheric"];
    for (const banned of LUNAR_BANNED) {
      if (allText.includes(banned)) {
        issues.push({
          category: "lunar",
          severity: "error",
          message: `Lunar/space scene contains banned expression: "${banned}"`,
          autoFixable: true,
          suggestedFix: `Remove or rewrite "${banned}" for no-atmosphere environment`,
        });
      }
    }
  }

  // ── Score 계산 ────────────────────────────────────────────────
  const errorCount = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  const autoFixCount = issues.filter(i => i.autoFixable).length;

  let score = 100;
  score -= errorCount * 15;
  score -= warningCount * 5;
  score = Math.max(0, Math.min(100, score));

  if (errorCount === 0 && suggestions.length === 0) {
    suggestions.push("Sequence passes all quality checks");
  }

  return {
    valid: errorCount === 0,
    score,
    issues,
    suggestions,
    autoFixCount,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Gemini QA Provider Interface
// ═══════════════════════════════════════════════════════════════════

/**
 * Gemini QA capability 정의.
 * generate-video에서 직접 호출하지 않고,
 * preflight/normalize 단계 또는 별도 QA route에서 수행.
 */
export interface GeminiQACapability {
  /** structuredSequence 전체 품질 평가 */
  validateSequence: "structuredSequence_validation";
  /** sceneType 정확성 검증 */
  validateSceneType: "sceneType_validation";
  /** quality scoring (0-100) */
  qualityScoring: "quality_scoring";
  /** auto-fix suggestions */
  autoFixSuggestions: "auto_fix";
  /** rewrite / normalization */
  rewriteNormalize: "rewrite_normalize";
}

/**
 * Gemini QA 결과를 structuredSequence에 병합.
 * preflight 결과의 autoFixable 항목을 실제로 적용.
 */
export function applyQualityFixes(
  seq: StructuredSequenceDocument,
  result: QualityCheckResult,
): { fixed: StructuredSequenceDocument; appliedFixes: string[] } {
  const fixed = JSON.parse(JSON.stringify(seq)) as StructuredSequenceDocument;
  const appliedFixes: string[] = [];

  for (const issue of result.issues) {
    if (!issue.autoFixable) continue;

    switch (issue.category) {
      case "pos_neg_conflict": {
        // pos/neg conflict는 sequence-assembler의 sanitize pipeline에서 처리
        appliedFixes.push(`[QA] ${issue.message} — deferred to sanitize pipeline`);
        break;
      }
      case "environment": {
        // Environment scene: force wide framing + continuous camera
        if (issue.message.includes("close framing") && fixed.shotPlan?.camera) {
          fixed.shotPlan.camera.framing = "WS";
          appliedFixes.push("[QA] Environment framing → WS");
        }
        // Environment scene: ensure continuous camera motion for longer scenes
        if (fixed.shotPlan?.camera && fixed.durationSec > 3) {
          const motion = fixed.shotPlan.camera.motion?.toLowerCase() || "";
          if (!motion || motion === "static") {
            fixed.shotPlan.camera.motion = "slow push-in";
            appliedFixes.push("[QA] Environment static camera → slow push-in");
          }
        }
        break;
      }
      case "character": {
        // Character scene: ensure characterRef exists
        if (fixed.shotPlan && !fixed.shotPlan.subject?.characterRef) {
          const subjectPrimary = fixed.shotPlan.subject?.primary || "";
          if (subjectPrimary) {
            fixed.shotPlan.subject.characterRef = subjectPrimary;
            appliedFixes.push(`[QA] Character scene: auto-fill characterRef from primary subject`);
          }
        }
        break;
      }
      case "map": {
        // Map scene: force overhead angle + WS framing
        if (fixed.shotPlan?.camera) {
          if (fixed.shotPlan.camera.angle !== "overhead") {
            fixed.shotPlan.camera.angle = "overhead";
            appliedFixes.push("[QA] Map scene: angle → overhead");
          }
          const framing = fixed.shotPlan.camera.framing?.toUpperCase();
          if (framing && !["WS", "LS", "MLS"].includes(framing)) {
            fixed.shotPlan.camera.framing = "WS";
            appliedFixes.push("[QA] Map scene: framing → WS");
          }
        }
        break;
      }
      case "anchors": {
        // Missing WHERE anchors: extract from environment field
        if (issue.message.includes("placeIdentityAnchors") && fixed.shotPlan) {
          const env = fixed.shotPlan.environment || fixed.shotPlan.locationCue || "";
          if (env) {
            if (!fixed.placeIdentityAnchors) fixed.placeIdentityAnchors = [];
            if (fixed.placeIdentityAnchors.length === 0) {
              fixed.placeIdentityAnchors.push(env.slice(0, 100));
              appliedFixes.push(`[QA] Auto-fill placeIdentityAnchors from environment: "${env.slice(0, 50)}"`);
            }
          }
        }
        // Missing WHAT evidence: extract from action field
        if (issue.message.includes("situationEvidence") && fixed.shotPlan) {
          const action = fixed.shotPlan.action || "";
          if (action) {
            if (!fixed.situationEvidence) fixed.situationEvidence = [];
            if (fixed.situationEvidence.length === 0) {
              fixed.situationEvidence.push(action.slice(0, 100));
              appliedFixes.push(`[QA] Auto-fill situationEvidence from action: "${action.slice(0, 50)}"`);
            }
          }
        }
        break;
      }
      case "sceneType": {
        // Infer sceneType from shotPlan content
        if (fixed.shotPlan && (!fixed.sceneType || fixed.sceneType === "unknown")) {
          const allText = JSON.stringify(fixed.shotPlan).toLowerCase();
          if (/\b(map|terrain|topograph|globe|continent|border)\b/.test(allText)) {
            fixed.sceneType = "map-graphic";
            appliedFixes.push("[QA] Inferred sceneType → map-graphic");
          } else if (/\b(character|person|man|woman|face|portrait)\b/.test(allText)) {
            fixed.sceneType = "character-driven";
            appliedFixes.push("[QA] Inferred sceneType → character-driven");
          } else if (/\b(landscape|mountain|ocean|forest|desert|valley|horizon)\b/.test(allText)) {
            fixed.sceneType = "environment";
            appliedFixes.push("[QA] Inferred sceneType → environment");
          }
        }
        break;
      }
      case "shot_splitting": {
        // Shot splitting is handled by sequence-assembler's enforceMinimumShotCount
        appliedFixes.push(`[QA] ${issue.message} — deferred to shot-splitting engine`);
        break;
      }
      case "lunar":
      case "physics": {
        // Physics fixes are deferred to sanitizeAllFieldsForPhysics
        appliedFixes.push(`[QA] ${issue.message} — deferred to physics sanitizer`);
        break;
      }
    }
  }

  // Merge fix log
  if (!fixed.sanitizeFixes) fixed.sanitizeFixes = [];
  fixed.sanitizeFixes.push(...appliedFixes);

  return { fixed, appliedFixes };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Provider Role Constants
// ═══════════════════════════════════════════════════════════════════

/** 2-API 아키텍처 역할 정의 */
export const PROVIDER_ROLES = {
  /** VEO = 실제 영상 생성 전용 */
  veo: {
    role: "generation" as const,
    capabilities: ["text-to-video", "image-to-video", "task-polling"] as const,
    description: "Primary video generation engine",
  },
  /** Gemini = QA/validation/normalization 전용 */
  gemini_qa: {
    role: "qa" as const,
    capabilities: [
      "structuredSequence-validation",
      "sceneType-validation",
      "quality-scoring",
      "auto-fix-suggestions",
      "rewrite-normalization",
    ] as const,
    description: "Quality assurance and normalization engine (NOT video generation)",
  },
} as const;

export type ProviderRole = typeof PROVIDER_ROLES;

// ═══════════════════════════════════════════════════════════════════
// 5. Compact Mode — 토큰 절약용 응답 형식
// ═══════════════════════════════════════════════════════════════════

/**
 * Compact QA 결과 — Gemini가 토큰 한도에 가까울 때 사용.
 * 장황한 설명 없이 JSON 구조만 반환.
 */
export interface CompactQAResult {
  valid: boolean;
  issues: Array<{
    cat: string;      // category 축약
    sev: "e" | "w";   // error | warning
    msg: string;      // ≤50자
    fix?: string;     // autoFix 가능 시 ≤30자
  }>;
  autoFixes: string[];
  score: number;      // 0-100
}

/**
 * QualityCheckResult → CompactQAResult 변환.
 * Gemini에게 compact_json 응답을 요청할 때 기대 스키마로 사용.
 */
export function toCompactQA(result: QualityCheckResult): CompactQAResult {
  return {
    valid: result.valid,
    issues: result.issues.map(i => ({
      cat: i.category,
      sev: i.severity === "error" ? "e" : "w",
      msg: i.message.slice(0, 50),
      fix: i.autoFixable && i.suggestedFix ? i.suggestedFix.slice(0, 30) : undefined,
    })),
    autoFixes: result.issues.filter(i => i.autoFixable).map(i => i.suggestedFix || "").filter(Boolean),
    score: result.score,
  };
}

/**
 * CompactQAResult → QualityCheckResult 복원.
 * Gemini compact 응답을 기존 파이프라인에 병합할 때 사용.
 */
export function fromCompactQA(compact: CompactQAResult): QualityCheckResult {
  return {
    valid: compact.valid,
    score: compact.score,
    issues: compact.issues.map(i => ({
      category: i.cat as QualityCheckIssue["category"],
      severity: i.sev === "e" ? "error" : "warning",
      message: i.msg,
      autoFixable: !!i.fix,
      suggestedFix: i.fix,
    })),
    suggestions: compact.autoFixes,
    autoFixCount: compact.autoFixes.length,
  };
}
