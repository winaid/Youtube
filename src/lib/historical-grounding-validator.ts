/**
 * Historical Grounding Validator — 생성된 컷/프롬프트에 대해
 * 역사적 정확성을 검증하고 경고를 생성.
 *
 * preflight-validation.ts와 독립적으로 동작하며,
 * generate-cuts 후 결과물에 대해 사후 검증 수행.
 */
import type {
  HistoricalGroundingResult,
  HistoricalWarning,
  HistoricalWarningCode,
} from "@/types/historical-grounding";
import type { Cut } from "@/types";
import { resolveHistoricalGrounding } from "./historical-grounding-resolver";

export interface HistoricalValidationResult {
  /** 전체 유효성 */
  valid: boolean;
  /** 컷별 경고 */
  cutWarnings: CutHistoricalWarning[];
  /** 전체 수준 경고 */
  globalWarnings: HistoricalWarning[];
  /** 전체 grounding 결과 */
  grounding: HistoricalGroundingResult;
}

export interface CutHistoricalWarning {
  cutNumber: number;
  warnings: HistoricalWarning[];
}

/**
 * 시나리오 텍스트 + 생성된 컷 전체를 검증.
 * @param storyText 원본 시나리오
 * @param cuts 생성된 컷 배열
 */
export function validateHistoricalGrounding(
  storyText: string,
  cuts: Cut[],
): HistoricalValidationResult {
  const grounding = resolveHistoricalGrounding(storyText);

  const result: HistoricalValidationResult = {
    valid: true,
    cutWarnings: [],
    globalWarnings: [...grounding.warnings],
    grounding,
  };

  if (!grounding.detected) return result;

  // ── 1. 전체 수준 검증 ──

  // 역사적 맥락이 감지되었는데 region/period가 없으면 경고
  if (!grounding.region || !grounding.period) {
    addGlobalWarning(result, {
      code: "missing_historical_resolution",
      message: "역사적 배경이 감지되었으나 지역/시대를 확정하지 못했습니다.",
      severity: "warning",
      suggestion: "시나리오에 구체적 시대와 지역을 명시하세요.",
    });
  }

  // visualAnchors가 부족하면 경고
  if (grounding.visualAnchors.length < 2 && grounding.confidence >= 50) {
    addGlobalWarning(result, {
      code: "missing_visual_evidence",
      message: "역사적 시각 디테일(복식/건축/소품)이 부족합니다. 생성되는 영상이 시대를 정확히 반영하지 못할 수 있습니다.",
      severity: "warning",
    });
  }

  // ── 2. 컷별 검증 ──
  for (const cut of cuts) {
    const cutWarnings: HistoricalWarning[] = [];

    // 2a. 컷 프롬프트에서 시대착오 검사
    const promptText = [
      cut.videoPrompt,
      cut.sceneDescription,
      cut.imagePrompt,
    ].filter(Boolean).join(" ");

    const anachronisms = detectAnachronismsInPrompt(promptText, grounding);
    cutWarnings.push(...anachronisms);

    // 2b. 컷 프롬프트에 역사적 앵커가 반영되었는지 확인
    if (grounding.visualAnchors.length > 0 && grounding.confidence >= 60) {
      const hasAnyAnchor = grounding.visualAnchors.some(va =>
        promptText.toLowerCase().includes(va.description.substring(0, 20).toLowerCase())
      );
      if (!hasAnyAnchor && promptText.length > 50) {
        cutWarnings.push({
          code: "missing_cultural_anchors",
          message: `컷 ${cut.cutNumber}에 ${grounding.region} ${grounding.period}의 시각적 디테일이 반영되지 않았습니다.`,
          severity: "info",
          suggestion: "복식, 건축, 소품 등 시대 특유의 디테일을 프롬프트에 포함하세요.",
        });
      }
    }

    // 2c. 다른 문화권 요소 혼입 검사
    const crossCultural = detectCrossCulturalContamination(promptText, grounding);
    cutWarnings.push(...crossCultural);

    if (cutWarnings.length > 0) {
      result.cutWarnings.push({ cutNumber: cut.cutNumber, warnings: cutWarnings });
    }
  }

  // ── 3. valid 판정 ──
  const allWarnings = [
    ...result.globalWarnings,
    ...result.cutWarnings.flatMap(cw => cw.warnings),
  ];
  const hasErrors = allWarnings.some(w => w.severity === "error");
  result.valid = !hasErrors;

  return result;
}

// ── 내부 헬퍼 ──

function addGlobalWarning(result: HistoricalValidationResult, warning: HistoricalWarning): void {
  // 중복 방지
  const exists = result.globalWarnings.some(w => w.code === warning.code && w.message === warning.message);
  if (!exists) result.globalWarnings.push(warning);
}

/** 프롬프트 텍스트 내 시대착오 요소 감지 */
const PROMPT_ANACHRONISM_CHECKS: {
  pattern: RegExp;
  label: string;
  incompatibleWith: string[];
}[] = [
  { pattern: /smartphone|스마트폰|cell\s*phone|mobile\s*phone/i, label: "smartphone", incompatibleWith: ["Joseon Dynasty", "Edo Period", "Qing Dynasty (Late)", "Korean Empire / Enlightenment Period"] },
  { pattern: /electric\s*light|fluorescent|LED|형광등|전등/i, label: "electric lighting", incompatibleWith: ["Joseon Dynasty", "Edo Period"] },
  { pattern: /car\b|automobile|자동차|택시/i, label: "automobile", incompatibleWith: ["Joseon Dynasty", "Edo Period", "Qing Dynasty (Late)"] },
  { pattern: /concrete|콘크리트|skyscraper|고층\s*빌딩/i, label: "modern architecture", incompatibleWith: ["Joseon Dynasty", "Edo Period", "Qing Dynasty (Late)"] },
  { pattern: /neon|네온/i, label: "neon sign", incompatibleWith: ["Joseon Dynasty", "Edo Period", "Qing Dynasty (Late)", "Korean Empire / Enlightenment Period"] },
  { pattern: /plastic|플라스틱/i, label: "plastic", incompatibleWith: ["Joseon Dynasty", "Edo Period"] },
  { pattern: /television|TV|텔레비전/i, label: "television", incompatibleWith: ["Joseon Dynasty", "Edo Period", "Qing Dynasty (Late)", "Korean Empire / Enlightenment Period"] },
  { pattern: /computer|컴퓨터|laptop|노트북/i, label: "computer", incompatibleWith: ["Joseon Dynasty", "Edo Period", "Qing Dynasty (Late)", "Korean Empire / Enlightenment Period"] },
  { pattern: /wristwatch|손목시계/i, label: "wristwatch", incompatibleWith: ["Joseon Dynasty", "Edo Period"] },
];

function detectAnachronismsInPrompt(
  promptText: string,
  grounding: HistoricalGroundingResult,
): HistoricalWarning[] {
  if (!grounding.period) return [];

  const warnings: HistoricalWarning[] = [];
  for (const check of PROMPT_ANACHRONISM_CHECKS) {
    if (check.pattern.test(promptText) && check.incompatibleWith.includes(grounding.period)) {
      warnings.push({
        code: "anachronistic_object_risk",
        message: `'${check.label}'은(는) ${grounding.period}에 존재하지 않습니다.`,
        severity: "warning",
        suggestion: "해당 시대에 적합한 대안으로 교체하세요.",
      });
    }
  }
  return warnings;
}

/** 다른 문화권 요소 혼입 감지 */
const CROSS_CULTURAL_CHECKS: {
  pattern: RegExp;
  label: string;
  belongsTo: string;
}[] = [
  // 한국 고유
  { pattern: /hanbok|한복|갓|gat\b|dopo|도포/i, label: "Korean hanbok/gat", belongsTo: "Korea" },
  // 일본 고유
  { pattern: /kimono|기모노|tatami|다다미|shoji|쇼지|torii|도리이/i, label: "Japanese kimono/tatami", belongsTo: "Japan" },
  // 중국 고유
  { pattern: /qipao|치파오|mandarin\s*collar|변발|queue\s*hairstyle/i, label: "Chinese qipao/queue", belongsTo: "China" },
];

function detectCrossCulturalContamination(
  promptText: string,
  grounding: HistoricalGroundingResult,
): HistoricalWarning[] {
  if (!grounding.region || grounding.region === "Ambiguous-Asia") return [];

  const warnings: HistoricalWarning[] = [];
  for (const check of CROSS_CULTURAL_CHECKS) {
    if (check.belongsTo === grounding.region) continue; // 같은 문화권은 OK
    if (check.pattern.test(promptText)) {
      warnings.push({
        code: "mixed_asian_period_cues",
        message: `${grounding.region} 배경 장면에 ${check.belongsTo}의 요소(${check.label})가 포함되어 있습니다.`,
        severity: "error",
        suggestion: `${grounding.region} ${grounding.period || ""}에 적합한 요소로 교체하세요.`,
      });
    }
  }
  return warnings;
}
