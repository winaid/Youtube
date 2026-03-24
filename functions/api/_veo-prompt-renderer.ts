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
 * 지원 멀티샷 구조.
 * 8초: 4샷 기본. 7초(VEO extend): 3샷.
 */
export const SHOT_STRUCTURES = {
  /** 4샷: establish → develop → peak → resolve (8초용) */
  FOUR: [
    { startSec: 0, endSec: 2, role: "establish" },
    { startSec: 2, endSec: 4, role: "develop" },
    { startSec: 4, endSec: 6, role: "peak" },
    { startSec: 6, endSec: 8, role: "resolve" },
  ],
  /** 3샷: establish → develop → resolve (7초 VEO extend용) */
  THREE: [
    { startSec: 0, endSec: 2, role: "establish" },
    { startSec: 2, endSec: 5, role: "develop" },
    { startSec: 5, endSec: 7, role: "resolve" },
  ],
  /** 3샷 8초: establish → develop → resolve */
  THREE_8S: [
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
  const seen: string[] = [];
  const unique: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (norm.length < 10) { unique.push(s.trim()); continue; }
    let isDupe = false;
    for (let i = 0; i < seen.length; i++) {
      const prev = seen[i];
      if (prev === norm) { isDupe = true; break; }
      if (prev.includes(norm)) { isDupe = true; break; }
      // 새 문장이 더 구체적이면(+15자) 기존 짧은 버전을 교체
      if (norm.includes(prev) && norm.length > prev.length + 15) {
        seen[i] = norm;
        isDupe = true; // 교체했으므로 추가로 push하지 않음
        // unique에서도 교체
        for (let j = 0; j < unique.length; j++) {
          const uNorm = unique[j].trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
          if (prev.includes(uNorm) || uNorm === prev) { unique[j] = s.trim(); break; }
        }
        break;
      }
    }
    if (!isDupe) {
      seen.push(norm);
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

  // 합이 목표 duration과 다르면 비례 스케일링
  // VEO: 첫 컷 8초, extend 컷 7초 — 둘 다 허용
  const targetDuration = (currentSec === 7 || currentSec === 8) ? currentSec : 8;
  if (currentSec !== targetDuration && entries.length > 0) {
    const ratio = targetDuration / currentSec;
    let runningStart = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const origDur = e.endSec - e.startSec;
      const scaledDur = i === entries.length - 1
        ? targetDuration - runningStart  // 마지막 샷: 나머지 전부
        : Math.max(1, Math.round(origDur * ratio));
      e.startSec = runningStart;
      e.endSec = runningStart + Math.max(1, scaledDur);
      runningStart = e.endSec;
    }
    entries[entries.length - 1].endSec = targetDuration;
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

  // VEO에 구체적 시각 지시 — "developing the scene" 같은 추상어 대신
  // 실제 카메라 동작/구도로 기술
  const roleFramings: Record<string, string> = {
    establish: "Wide shot, slow pan revealing full space,",
    develop: "Medium shot, lateral tracking following subject,",
    peak: "Close-up, slow push-in on key detail,",
    resolve: "Wide shot, slow pull-back showing full scene,",
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
  /** Historical grounding — 역사적 맥락 구체화 결과 (있으면 프롬프트에 주입) */
  historicalGrounding?: {
    visualAnchors?: Array<{ category: string; description: string }>;
    avoid?: string[];
    region?: string | null;
    period?: string | null;
  };
  /** 분절 편집 모드 — true이면 최종 프롬프트 500자 hard limit 강제 */
  fragmentedEditMode?: boolean;
}

/**
 * VEO 프롬프트 렌더러 — 모든 생성 요청의 최종 출력.
 *
 * 반드시 8초 멀티샷 타임스탬프 형식을 반환.
 * 단일샷 입력이 들어와도 자동으로 멀티샷으로 변환.
 */
export function renderVeoPrompt(input: VeoPromptRendererInput): VeoRenderedPrompt {
  const cleanupLog: string[] = [];

  // 프롬프트 정리 — 중복 제거는 generate-video.ts에서 최종 1회만 수행
  let cleanedPrompt = stripInternalTags(input.prompt);

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

  // 각 샷 프롬프트 길이 제한
  // 분절 편집 모드: 500자 hard limit / 일반 모드: 3000자
  const FRAGMENTED_CHAR_LIMIT = 500;
  const maxPromptLen = input.fragmentedEditMode ? FRAGMENTED_CHAR_LIMIT : 3000;
  let finalPrompt = timestampPrompt;
  if (finalPrompt.length > maxPromptLen) {
    // 분절 편집 모드에서는 정보 밀도를 높이는 방향으로 압축
    // shot 구조(timestamp brackets)를 보존하면서 action 부분만 축소
    const anchorLen = (globalAnchor?.length ?? 0) + 2;
    const budgetPerShot = Math.floor((maxPromptLen - anchorLen) / shots.length) - 15; // timestamp bracket ~15 chars
    const shortenedShots = shots.map(s => ({
      ...s,
      prompt: s.prompt.length > budgetPerShot
        ? s.prompt.slice(0, budgetPerShot - 1) + "…"
        : s.prompt,
    }));
    finalPrompt = renderTimestampPrompt(shortenedShots, globalAnchor);
    cleanupLog.push(`[veo-renderer] Prompt truncated: ${timestampPrompt.length} → ${finalPrompt.length} chars (limit=${maxPromptLen})`);
  }

  // 분절 편집 모드: final hard clamp — shot progression 유지하면서 500자 보장
  if (input.fragmentedEditMode && finalPrompt.length > FRAGMENTED_CHAR_LIMIT) {
    // shot boundary-aware truncation: 각 shot line을 균등 축소
    const lines = finalPrompt.split("\n");
    const shotLines = lines.filter(l => l.startsWith("["));
    const nonShotLines = lines.filter(l => !l.startsWith("["));
    const nonShotLen = nonShotLines.join("\n").length + 1;
    const availableForShots = FRAGMENTED_CHAR_LIMIT - nonShotLen;

    if (shotLines.length > 0 && availableForShots > shotLines.length * 20) {
      const perShot = Math.floor(availableForShots / shotLines.length) - 1;
      const truncatedShotLines = shotLines.map(line => {
        if (line.length <= perShot) return line;
        // Keep timestamp bracket intact, truncate content after it
        const bracketEnd = line.indexOf("]");
        if (bracketEnd >= 0 && bracketEnd < perShot - 5) {
          return line.slice(0, perShot - 1) + "…";
        }
        return line.slice(0, perShot - 1) + "…";
      });
      finalPrompt = [...nonShotLines.filter(l => l.trim()), ...truncatedShotLines].join("\n");
    } else {
      finalPrompt = finalPrompt.slice(0, FRAGMENTED_CHAR_LIMIT - 1) + "…";
    }
    cleanupLog.push(`[veo-renderer] Fragmented edit hard clamp applied: ${finalPrompt.length}/${FRAGMENTED_CHAR_LIMIT} chars, ${shotLines.length} shot boundaries preserved`);
  }

  // ── 텍스트 방지: noTextSuffix("no text, no watermark")가 프롬프트 끝에 포함됨.
  // stripTextForVeo()가 불필요한 텍스트 관련 단어를 추가 정리.

  // ── Historical grounding injection — 역사적 시각 앵커를 프롬프트에 주입 ──
  if (input.historicalGrounding) {
    const hg = input.historicalGrounding;
    if (hg.visualAnchors && hg.visualAnchors.length > 0) {
      const anchorDirective = hg.visualAnchors
        .map(va => `${va.description}`)
        .join(". ");
      const settingLine = (hg.region && hg.period)
        ? `Historical setting: ${hg.region}, ${hg.period}. `
        : "";
      finalPrompt = `${settingLine}Visual references: ${anchorDirective}.\n\n${finalPrompt}`;
      cleanupLog.push(`[veo-renderer] Historical grounding injected: ${hg.region} ${hg.period}`);
    }
  }

  // ── Historical grounding negative prompt — avoid 요소 추가 ──
  let finalNegative = input.negativePrompt || "text overlay, watermark, logo, blurry, distorted face";
  if (input.historicalGrounding?.avoid && input.historicalGrounding.avoid.length > 0) {
    finalNegative += ", " + input.historicalGrounding.avoid.join(", ");
    cleanupLog.push(`[veo-renderer] Historical avoid items added to negative prompt`);
  }

  return {
    timestampPrompt: finalPrompt,
    negativePrompt: finalNegative,
    globalAnchor,
    shotCount: shots.length,
    totalDurationSec: shots.length > 0 ? shots[shots.length - 1].endSec : 8,
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
