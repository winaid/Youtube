/**
 * _veo-prompt-renderer.ts — VEO 타임스탬프 멀티샷 프롬프트 렌더러
 *
 * 핵심 정책:
 *   - 모든 VEO 프롬프트는 반드시 8초 멀티샷 타임스탬프 형식
 *   - 기본 4샷 구조: [00:00-00:02], [00:02-00:04], [00:04-00:06], [00:06-00:08]
 *   - 단일샷 프롬프트 금지 — 항상 최소 2샷 이상
 *   - 각 샷에는 역할(establish/develop/peak/resolve) 포함
 *
 * 출력 형식:
 *   [00:00-00:02] Wide establishing shot of ...
 *   [00:02-00:04] Medium shot developing ...
 *   [00:04-00:06] Close-up peak moment ...
 *   [00:06-00:08] Resolving wide shot ...
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface VeoMultiShotEntry {
  index: number;
  prompt: string;
  startSec: number;
  endSec: number;
  role?: string;
}

export interface VeoRenderedPrompt {
  /** 최종 타임스탬프 프롬프트 (VEO API에 전송할 메인 프롬프트) */
  timestampPrompt: string;
  /** 네거티브 프롬프트 */
  negativePrompt: string;
  /** 글로벌 스타일 앵커 (타임스탬프 앞에 배치) */
  globalAnchor: string;
  /** 샷 수 */
  shotCount: number;
  /** 총 듀레이션 */
  totalDurationSec: number;
  /** 정리 로그 */
  cleanupLog: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Shot Structures — 8초 전용
// ═══════════════════════════════════════════════════════════════════

/**
 * 지원 멀티샷 구조 (모두 8초 합산).
 * 4샷이 기본값.
 */
export const SHOT_STRUCTURES = {
  /** 4샷: establish → develop → peak → resolve */
  FOUR: [
    { startSec: 0, endSec: 2, role: "establish" },
    { startSec: 2, endSec: 4, role: "develop" },
    { startSec: 4, endSec: 6, role: "peak" },
    { startSec: 6, endSec: 8, role: "resolve" },
  ],
  /** 3샷: establish → develop+peak → resolve */
  THREE: [
    { startSec: 0, endSec: 2, role: "establish" },
    { startSec: 2, endSec: 5, role: "develop" },
    { startSec: 5, endSec: 8, role: "resolve" },
  ],
  /** 2샷: establish → resolve */
  TWO: [
    { startSec: 0, endSec: 4, role: "establish" },
    { startSec: 4, endSec: 8, role: "resolve" },
  ],
} as const;

export type ShotStructureType = keyof typeof SHOT_STRUCTURES;

// ═══════════════════════════════════════════════════════════════════
// Internal Tag Cleanup
// ═══════════════════════════════════════════════════════════════════

const INTERNAL_TAG_PATTERNS = [
  /\[VISUAL LOCK\]\s*/gi,
  /\[CHARACTER LOCK\]\s*/gi,
  /\[CONTINUATION\][^.]*\./gi,
  /\[ENDING\][^.]*\./gi,
  /\[Establishing wide shot\]\s*/gi,
  /\[Developing mid shot\]\s*/gi,
  /\[Peak dramatic moment\]\s*/gi,
  /\[Resolving close-up\]\s*/gi,
  /\[Transition\]\s*/gi,
  /\[Insert detail\]\s*/gi,
  /\[Shot \d+\/\d+[^\]]*\]\s*/gi,
];

function stripInternalTags(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(/\[(?:VISUAL|CHARACTER|CONTINUATION|ENDING|NARRATIVE|LOCK)[^\]]*\]\s*/gi, "");
  return cleaned.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

function deduplicatePromptClauses(text: string): string {
  const sentences = text.split(/\.\s+/).filter(s => s.trim().length > 3);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (norm.length < 10) { unique.push(s.trim()); continue; }
    let isDupe = false;
    for (const prev of seen) {
      if (prev === norm || prev.includes(norm) || norm.includes(prev)) { isDupe = true; break; }
    }
    if (!isDupe) {
      seen.add(norm);
      unique.push(s.trim());
    }
  }
  return unique.join(". ").replace(/\.\s*\./g, ".").trim();
}

// ═══════════════════════════════════════════════════════════════════
// Timestamp Formatting
// ═══════════════════════════════════════════════════════════════════

function formatTimestamp(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * 멀티샷 엔트리 배열 → VEO 타임스탬프 프롬프트 문자열
 */
export function renderTimestampPrompt(shots: VeoMultiShotEntry[], globalAnchor?: string): string {
  const lines: string[] = [];
  if (globalAnchor && globalAnchor.trim().length > 0) {
    lines.push(globalAnchor.trim());
    lines.push("");
  }
  for (const shot of shots) {
    const start = formatTimestamp(shot.startSec);
    const end = formatTimestamp(shot.endSec);
    lines.push(`[${start}-${end}] ${shot.prompt.trim()}`);
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// Multi-shot → Timestamp Conversion
// ═══════════════════════════════════════════════════════════════════

/**
 * 기존 멀티샷 배열(index, prompt, duration, role)을
 * VEO 타임스탬프 엔트리로 변환.
 *
 * 입력이 없거나 부족하면 기본 4샷 구조를 자동 생성.
 */
export function convertMultiShotToTimestamp(
  multiShot: Array<{ index: number; prompt: string; duration: string; role?: string }> | undefined,
  basePrompt: string,
  structureType?: ShotStructureType,
): VeoMultiShotEntry[] {
  const structure = SHOT_STRUCTURES[structureType || "FOUR"];

  // 멀티샷이 없거나 부족하면 basePrompt에서 자동 생성
  if (!multiShot || multiShot.length < 2) {
    return buildDefaultMultiShot(basePrompt, structure);
  }

  // 기존 멀티샷을 타임스탬프로 매핑
  // duration 합이 8초가 되도록 정규화
  const entries: VeoMultiShotEntry[] = [];
  let currentSec = 0;

  for (let i = 0; i < multiShot.length; i++) {
    const shot = multiShot[i];
    const dur = Math.max(1, Math.round(parseFloat(shot.duration) || 2));
    entries.push({
      index: i + 1,
      prompt: stripInternalTags(shot.prompt),
      startSec: currentSec,
      endSec: currentSec + dur,
      role: shot.role,
    });
    currentSec += dur;
  }

  // 합이 8초가 아니면 마지막 샷 조정
  if (currentSec !== 8 && entries.length > 0) {
    const last = entries[entries.length - 1];
    const diff = 8 - currentSec;
    last.endSec = last.endSec + diff;
    if (last.endSec <= last.startSec) {
      last.endSec = last.startSec + 1;
    }
  }

  return entries;
}

/**
 * basePrompt에서 기본 4샷 멀티샷을 자동 생성.
 */
function buildDefaultMultiShot(
  basePrompt: string,
  structure: ReadonlyArray<{ startSec: number; endSec: number; role: string }>,
): VeoMultiShotEntry[] {
  const cleaned = stripInternalTags(basePrompt);
  const sentences = cleaned.split(/\.\s+/).filter(s => s.trim().length > 10);

  const roleFramings: Record<string, string> = {
    establish: "Wide establishing shot,",
    develop: "Medium shot developing the scene,",
    peak: "Close-up at peak intensity,",
    resolve: "Wide resolving shot,",
  };

  return structure.map((slot, i) => {
    const framing = roleFramings[slot.role] || "";
    // 문장들을 샷에 분배 (라운드 로빈)
    const sentenceForShot = sentences[i % sentences.length] || cleaned.split(".")[0] || cleaned;
    return {
      index: i + 1,
      prompt: `${framing} ${sentenceForShot.trim()}`.trim(),
      startSec: slot.startSec,
      endSec: slot.endSec,
      role: slot.role,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Main Renderer
// ═══════════════════════════════════════════════════════════════════

export interface VeoPromptRendererInput {
  /** 메인 프롬프트 (structuredSequence 직렬화 또는 raw prompt) */
  prompt: string;
  /** 네거티브 프롬프트 */
  negativePrompt: string;
  /** 기존 멀티샷 배열 (있으면 변환, 없으면 자동 생성) */
  multiShot?: Array<{ index: number; prompt: string; duration: string; role?: string }>;
  /** 글로벌 스타일 앵커 */
  styleAnchor?: string;
  /** 샷 구조 타입 (기본: FOUR) */
  structureType?: ShotStructureType;
}

/**
 * VEO 프롬프트 렌더러 — 모든 생성 요청의 최종 출력.
 *
 * 반드시 8초 멀티샷 타임스탬프 형식을 반환.
 * 단일샷 입력이 들어와도 자동으로 멀티샷으로 변환.
 */
export function renderVeoPrompt(input: VeoPromptRendererInput): VeoRenderedPrompt {
  const cleanupLog: string[] = [];

  // 프롬프트 정리
  let cleanedPrompt = stripInternalTags(input.prompt);
  cleanedPrompt = deduplicatePromptClauses(cleanedPrompt);

  // 멀티샷 변환 (항상 멀티샷 강제)
  const shots = convertMultiShotToTimestamp(
    input.multiShot,
    cleanedPrompt,
    input.structureType,
  );

  if (!input.multiShot || input.multiShot.length < 2) {
    cleanupLog.push("[veo-renderer] Auto-generated multishot from single prompt (8s 4-shot structure)");
  }

  // 글로벌 앵커 추출
  const globalAnchor = input.styleAnchor || extractGlobalAnchor(cleanedPrompt);

  // 타임스탬프 프롬프트 생성
  const timestampPrompt = renderTimestampPrompt(shots, globalAnchor);

  // 각 샷 프롬프트 길이 제한 (VEO는 전체 1024 토큰)
  // 전체 프롬프트가 너무 길면 각 샷을 축소
  const maxPromptLen = 3000; // chars
  let finalPrompt = timestampPrompt;
  if (finalPrompt.length > maxPromptLen) {
    const shortenedShots = shots.map(s => ({
      ...s,
      prompt: s.prompt.slice(0, Math.floor(maxPromptLen / shots.length) - 20),
    }));
    finalPrompt = renderTimestampPrompt(shortenedShots, globalAnchor);
    cleanupLog.push(`[veo-renderer] Prompt truncated: ${timestampPrompt.length} → ${finalPrompt.length} chars`);
  }

  // ── 자막/텍스트 방지 강화: VEO는 negative prompt 미지원 → positive에서 강제 ──
  const TEXT_FREE_DIRECTIVE = "This video must contain absolutely no text, no subtitles, no captions, no title cards, no written words, no on-screen typography of any kind. Purely visual storytelling only.";
  finalPrompt = TEXT_FREE_DIRECTIVE + "\n\n" + finalPrompt;

  return {
    timestampPrompt: finalPrompt,
    negativePrompt: input.negativePrompt || "text overlay, watermark, logo, blurry, distorted face",
    globalAnchor,
    shotCount: shots.length,
    totalDurationSec: 8,
    cleanupLog,
  };
}

/**
 * 프롬프트에서 글로벌 스타일 앵커를 추출.
 */
function extractGlobalAnchor(prompt: string): string {
  const globalPatterns = [
    /\b(claymation|stop[\s-]?motion|watercolor|oil\s+paint|anime|cel[\s-]?shad|photorealistic|cinematic|documentary|live[\s-]?action)\b/i,
    /\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted\s+color)/i,
    /\b(1[0-9]{3}s|19th\s+century|medieval|victorian)/i,
  ];

  const clauses = prompt.split(/\.\s+/).filter(s => s.trim().length > 3);
  const global: string[] = [];
  for (const clause of clauses) {
    if (globalPatterns.some(p => p.test(clause))) {
      global.push(clause.trim());
    }
  }
  return global.length > 0 ? global.slice(0, 2).join(". ") : "";
}
