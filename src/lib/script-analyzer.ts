/**
 * script-analyzer.ts — 대본 → 릴 시퀀스 프로덕션 구조 변환 엔진
 *
 * 3-Phase Progressive Architecture:
 *   Phase A: Fast structural analysis (beats, boundaries, skeleton sequences)
 *   Phase B: Per-sequence detail enrichment (cuts, strategies, cliffhangers)
 *   Phase C: Optional LLM deep analysis (server-side)
 *
 * 핵심 원칙:
 *   - 텍스트를 문장 수로 나누지 않는다
 *   - 논점/비트 전환을 기준으로 시퀀스 경계를 결정한다
 *   - 모든 컷은 존재 이유가 있어야 한다
 *   - 결과물은 요약이 아니라 프로덕션 구조다
 *   - Phase A is returned instantly for progressive rendering
 *   - Phase B is lazy per-sequence, parallelizable
 *   - Phase C is optional background enrichment
 *
 * grep: analyzeScript, analyzeScriptPhaseA, enrichSequenceDetail,
 *       parseScriptBeats, planSequenceBoundaries,
 *       generateCutProgression, convertToCuts, estimateRuntime
 */

import type { ShotRole, Cut } from "@/types";
import type {
  ScriptAnalysisResult,
  ScriptAnalysisIssue,
  AnalysisConfidence,
  AnalyzedSequence,
  AnalyzedCut,
  SequenceBeatType,
  SequenceEndingMode,
  RetentionStrategy,
  VisualStrategy,
  CutVisualFocus,
  ScriptContentType,
  PhaseAResult,
} from "@/types/script-analysis";
import { SEQUENCE_MIN_DURATION } from "@/lib/sequence-density";
import { normalizeAnalysisResult, safeString, safeArray, safeNumber } from "@/lib/normalize";
import { estimateNarrationDuration, estimateNarrationRuntime } from "@/lib/narration-timing";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** 시퀀스 목표 duration 범위 */
const SEQ_MIN_SEC = SEQUENCE_MIN_DURATION; // 8
const SEQ_MAX_SEC = 15;
const SEQ_TARGET_SEC = 10;

/** 문장당 최소 예상 화면 시간 (나레이션 없는 시각적 표현 포함) */
const MIN_SEC_PER_SENTENCE = 2;

/** 시퀀스당 컷 수 범위 */
const MIN_CUTS_PER_SEQ = 2;
const MAX_CUTS_PER_SEQ = 6;

// ═══════════════════════════════════════════════════════════════════
// Caching Layer
// ═══════════════════════════════════════════════════════════════════

const CACHE_MAX = 20;
const beatCache = new Map<string, ScriptBeat[]>();
const boundaryCache = new Map<string, ScriptBeat[][]>();
const fullAnalysisCache = new Map<string, ScriptAnalysisResult>();

/** Simple string hash for cache keys */
export function scriptHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
  }
  return String(h);
}

function cacheSet<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
}

/** Clear all caches (for testing) */
export function clearAnalysisCache(): void {
  beatCache.clear();
  boundaryCache.clear();
  fullAnalysisCache.clear();
}

// ═══════════════════════════════════════════════════════════════════
// Beat Detection — 대본에서 논점 비트를 추출
// ═══════════════════════════════════════════════════════════════════

/** 하나의 서사 비트 */
export interface ScriptBeat {
  /** 원본 텍스트 */
  text: string;
  /** 비트 인덱스 (0-based) */
  index: number;
  /** 추정 화면 시간 (초) */
  estimatedSec: number;
  /** 비트 타입 힌트 */
  typeHint: SequenceBeatType;
  /** 강도 (0-1): 얼마나 "충격적"인가 */
  intensity: number;
  /** 전환 강도 (0-1): 이전 비트와 얼마나 다른가 */
  transitionStrength: number;
}

/** 훅 감지 키워드 (한국어) */
const HOOK_MARKERS = /(?:사실|실은|아이러니|충격|놀라|반전|^만약|^그런데|알고\s*보면|진짜\s*이유|최초|역대|최악|최고|파괴|혁명|붕괴|없었다면|몰랐던|비밀|금기|터지|폭발|위기)/;

/** 전환 감지 키워드 */
const TRANSITION_MARKERS = /(?:하지만|그런데|그러나|반면에?|한편|결과적으로|결국|이로\s*인해|이\s*때문에|왜냐하면|그래서|덕분에|그\s*결과|이후|이전에|반대로|오히려|물론|더\s*나아가|뿐만\s*아니라)/;

/** 결론/역설 감지 키워드 */
const CONCLUSION_MARKERS = /(?:결국|아이러니|역설|결론|요약하면|정리하면|다시\s*말해|즉|핵심은|본질은|진짜\s*의미|역사가\s*보여|교훈|시사점|의미|남긴\s*것|바꿨|바뀌|탄생|시작)/;

/** 인과 관계 감지 */
const CAUSAL_MARKERS = /(?:때문에|덕분에|으로\s*인해|결과|영향|원인|이유|파급|연쇄|도미노|촉발|초래|야기|유발)/;

/** 감정/충격 강도 키워드 */
const INTENSITY_MARKERS = /(?:충격|경악|공포|절망|분노|환희|광기|붕괴|파괴|학살|멸망|전멸|폭발|혁명|기적|불가능|전례\s*없|상상|믿기\s*어려|놀라운|엄청|압도|치명|결정적)/;

/**
 * 대본 텍스트를 서사 비트로 분리.
 *
 * 문장 수가 아닌 논점 전환을 기준으로 분리한다.
 * - 전환 키워드 (하지만, 그런데, 결과적으로 등)
 * - 빈 줄
 * - 인과 관계 전환
 */
export function parseScriptBeats(scriptText: string): ScriptBeat[] {
  const text = scriptText.trim();
  if (!text) return [];

  // 1단계: 문장 분리 (마침표, 물음표, 느낌표, 줄바꿈 기준)
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n{2,}|\n(?=[가-힣])/g)
    .map(s => s.trim())
    .filter(s => s.length > 2);

  if (sentences.length === 0) return [];

  // 2단계: 문장을 논점 비트로 그룹핑
  const beats: ScriptBeat[] = [];
  let currentGroup: string[] = [];
  let beatIndex = 0;

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    const groupText = currentGroup.join(" ");
    const sec = estimateSentenceGroupDuration(groupText);
    const typeHint = detectBeatType(groupText, beatIndex, beats.length === 0);
    const intensity = detectIntensity(groupText);
    const transitionStrength = currentGroup.length > 0 && beats.length > 0
      ? detectTransitionStrength(beats[beats.length - 1].text, groupText)
      : 0;

    beats.push({
      text: groupText,
      index: beatIndex,
      estimatedSec: sec,
      typeHint,
      intensity,
      transitionStrength,
    });
    beatIndex++;
    currentGroup = [];
  };

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // 전환 키워드가 문장 시작에 있으면 새 비트
    if (currentGroup.length > 0 && TRANSITION_MARKERS.test(sentence.slice(0, 20))) {
      flushGroup();
    }

    currentGroup.push(sentence);

    // 3문장 이상 누적되면 강제 분리 (너무 긴 비트 방지)
    if (currentGroup.length >= 3) {
      flushGroup();
    }
  }
  flushGroup();

  // 3단계: 첫 비트가 훅이 아니면 타입 재분류
  if (beats.length > 0 && beats[0].typeHint !== "hook") {
    // 가장 강한 강도의 비트를 찾아 훅 후보로 표시
    const hookCandidate = beats.reduce((best, b) =>
      b.intensity > best.intensity ? b : best, beats[0]);
    if (hookCandidate.index === 0) {
      beats[0].typeHint = "hook";
    }
  }

  return beats;
}

/** 문장 그룹의 예상 화면 시간 계산 */
function estimateSentenceGroupDuration(text: string): number {
  const est = estimateNarrationDuration(text, "natural");
  return Math.max(MIN_SEC_PER_SENTENCE, Math.ceil(est.totalWithBreathingSec));
}

/** 배경/설정 감지 키워드 */
const SETUP_MARKERS = /(?:배경|상황|당시|그\s*때|시작|원래|기존에?|이전에?|처음|과거|역사적|전통적|기본적)/;

/** 메커니즘/원리 감지 키워드 */
const MECHANISM_MARKERS = /(?:원리|메커니즘|작동|구조|시스템|방법|방식|과정|절차|원인|핵심|이유는|비결|비밀은|작용|원동력|동력)/;

/** 비트 타입 감지 — 주제 불문, 서사 구조 기반 */
function detectBeatType(text: string, index: number, isFirst: boolean): SequenceBeatType {
  if (isFirst && HOOK_MARKERS.test(text)) return "hook";
  if (isFirst) return "hook"; // 첫 비트는 항상 훅으로 시작
  if (CONCLUSION_MARKERS.test(text) && INTENSITY_MARKERS.test(text)) return "paradox";
  if (CONCLUSION_MARKERS.test(text)) return "payoff";
  if (INTENSITY_MARKERS.test(text)) return "reveal";
  if (CAUSAL_MARKERS.test(text)) return "consequence";
  if (MECHANISM_MARKERS.test(text)) return "mechanism";
  if (index === 1 && SETUP_MARKERS.test(text)) return "setup";
  if (TRANSITION_MARKERS.test(text.slice(0, 20))) return "transition";
  return "development";
}

/** 충격/감정 강도 감지 (0-1) */
function detectIntensity(text: string): number {
  let score = 0;
  if (HOOK_MARKERS.test(text)) score += 0.3;
  if (INTENSITY_MARKERS.test(text)) score += 0.4;
  if (CONCLUSION_MARKERS.test(text)) score += 0.2;
  // 물음표 = 호기심 유발
  if (/\?/.test(text)) score += 0.1;
  // 느낌표 = 강조
  if (/!/.test(text)) score += 0.1;
  return Math.min(1, score);
}

/** 두 텍스트 사이의 전환 강도 감지 (0-1) */
function detectTransitionStrength(prevText: string, nextText: string): number {
  let score = 0;
  // 전환 키워드로 시작하면 강한 전환
  if (TRANSITION_MARKERS.test(nextText.slice(0, 30))) score += 0.4;
  // 이전 비트와 주제가 다르면 전환
  const prevKeywords = extractTopicKeywords(prevText);
  const nextKeywords = extractTopicKeywords(nextText);
  const overlap = prevKeywords.filter(k => nextKeywords.includes(k)).length;
  const maxLen = Math.max(prevKeywords.length, nextKeywords.length, 1);
  const topicShift = 1 - (overlap / maxLen);
  score += topicShift * 0.4;
  // 강도 변화
  const prevIntensity = detectIntensity(prevText);
  const nextIntensity = detectIntensity(nextText);
  if (Math.abs(nextIntensity - prevIntensity) > 0.3) score += 0.2;
  return Math.min(1, score);
}

/** 주제 키워드 추출 (간단한 한국어 명사 추출) */
function extractTopicKeywords(text: string): string[] {
  // 한국어 2-4글자 명사 패턴 (조사 제거)
  const matches = text.match(/[가-힣]{2,4}(?=[은는이가을를에서의로와과]|\s|$)/g);
  return matches ? [...new Set(matches)] : [];
}

// ═══════════════════════════════════════════════════════════════════
// Sequence Boundary Planning
// ═══════════════════════════════════════════════════════════════════

/**
 * 비트 배열을 시퀀스 경계로 분할.
 *
 * 핵심 규칙:
 *   - 각 시퀀스는 8-15초 목표
 *   - 경계는 논점 전환 지점에서
 *   - 한 시퀀스에 너무 많은 주장을 넣지 않음
 *   - 시퀀스는 하나의 미니 이벤트 또는 미니 논증
 */
export function planSequenceBoundaries(beats: ScriptBeat[]): ScriptBeat[][] {
  if (beats.length === 0) return [];
  if (beats.length === 1) return [beats];

  const sequences: ScriptBeat[][] = [];
  let currentSeq: ScriptBeat[] = [];
  let currentDuration = 0;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const nextBeat = beats[i + 1];

    currentSeq.push(beat);
    currentDuration += beat.estimatedSec;

    // 시퀀스 분할 결정
    const shouldSplit = (() => {
      // 마지막 비트면 분할하지 않음
      if (i === beats.length - 1) return false;

      // 최대 duration 초과하면 강제 분할
      if (currentDuration >= SEQ_MAX_SEC) return true;

      // 목표 duration에 도달했고 다음 비트가 강한 전환이면 분할
      if (currentDuration >= SEQ_MIN_SEC && nextBeat && nextBeat.transitionStrength > 0.4) return true;

      // 목표 duration 근처이고 다음 비트가 새 타입이면 분할
      if (currentDuration >= SEQ_TARGET_SEC && nextBeat && nextBeat.typeHint !== beat.typeHint) return true;

      // 3개 이상 비트가 쌓였고 minimum duration을 넘었으면 분할
      if (currentSeq.length >= 3 && currentDuration >= SEQ_MIN_SEC) return true;

      return false;
    })();

    if (shouldSplit) {
      sequences.push([...currentSeq]);
      currentSeq = [];
      currentDuration = 0;
    }
  }

  // 남은 비트 처리
  if (currentSeq.length > 0) {
    // 너무 짧은 마지막 시퀀스는 이전에 합치기
    if (currentDuration < SEQ_MIN_SEC / 2 && sequences.length > 0) {
      sequences[sequences.length - 1].push(...currentSeq);
    } else {
      sequences.push(currentSeq);
    }
  }

  return sequences;
}

// ═══════════════════════════════════════════════════════════════════
// Cut Progression Planning
// ═══════════════════════════════════════════════════════════════════

/**
 * 시퀀스의 비트 그룹에서 내부 컷 프로그레션을 생성.
 *
 * 내부 컷은 reel-like progression을 따라야 한다:
 *   setup → escalation → reveal → payoff/reaction/consequence
 *
 * 페이크 분할 금지 — 모든 컷은 존재 이유가 있어야 한다.
 */
export function generateCutProgression(
  beats: ScriptBeat[],
  sequenceDurationSec: number,
  beatType: SequenceBeatType,
): AnalyzedCut[] {
  // 추천 컷 수 결정
  const cutCount = recommendCutCount(sequenceDurationSec, beatType);

  // 비트 타입에 따른 role 패턴 결정
  const roles = selectRolePattern(cutCount, beatType);

  // 각 컷에 대한 분석 생성
  return roles.map((role, i) => {
    const isFirst = i === 0;
    const isLast = i === roles.length - 1;

    return {
      role,
      visualFocus: selectVisualFocus(role, beatType, isFirst, isLast),
      changeFromPrevious: isFirst
        ? "시퀀스 시작 — 새로운 시각적 공간"
        : describeCutChange(roles[i - 1], role, beatType),
      narrativeFunction: describeNarrativeFunction(role, beatType, isFirst, isLast),
      suggestedPromptIntent: generatePromptIntent(role, beatType, beats, i, cutCount),
      retentionReason: describeRetentionReason(role, beatType, isFirst, isLast),
    };
  });
}

/** 시퀀스 duration과 비트 타입 기반 추천 컷 수 */
function recommendCutCount(durationSec: number, beatType: SequenceBeatType): number {
  let base: number;
  if (durationSec <= 8) base = 2;
  else if (durationSec <= 10) base = 3;
  else if (durationSec <= 12) base = 4;
  else base = 5;

  // 비트 타입에 따른 조정
  switch (beatType) {
    case "hook": return Math.min(MAX_CUTS_PER_SEQ, Math.max(MIN_CUTS_PER_SEQ, base));
    case "reveal": return Math.min(MAX_CUTS_PER_SEQ, base + 1);   // 리빌은 한 컷 더
    case "development": return Math.min(MAX_CUTS_PER_SEQ, base);
    case "payoff":
    case "paradox": return Math.min(MAX_CUTS_PER_SEQ, Math.max(3, base)); // 최소 3컷
    default: return Math.min(MAX_CUTS_PER_SEQ, base);
  }
}

/** 비트 타입에 따른 role 패턴 */
function selectRolePattern(cutCount: number, beatType: SequenceBeatType): ShotRole[] {
  switch (beatType) {
    case "hook":
      if (cutCount === 2) return ["establish", "peak"];
      if (cutCount === 3) return ["establish", "develop", "peak"];
      if (cutCount === 4) return ["establish", "develop", "peak", "resolve"];
      return ["establish", "develop", "insert", "peak", "resolve"];

    case "reveal":
      if (cutCount === 2) return ["develop", "peak"];
      if (cutCount === 3) return ["establish", "insert", "peak"];
      if (cutCount === 4) return ["establish", "develop", "insert", "peak"];
      return ["establish", "develop", "insert", "peak", "resolve"];

    case "consequence":
      if (cutCount === 2) return ["establish", "resolve"];
      if (cutCount === 3) return ["establish", "peak", "resolve"];
      if (cutCount === 4) return ["establish", "develop", "peak", "resolve"];
      return ["establish", "develop", "peak", "insert", "resolve"];

    case "paradox":
      if (cutCount === 2) return ["peak", "resolve"];
      if (cutCount === 3) return ["develop", "peak", "resolve"];
      if (cutCount === 4) return ["establish", "develop", "peak", "resolve"];
      return ["establish", "develop", "insert", "peak", "resolve"];

    case "payoff":
      if (cutCount === 2) return ["peak", "resolve"];
      if (cutCount === 3) return ["develop", "peak", "resolve"];
      if (cutCount === 4) return ["establish", "develop", "peak", "resolve"];
      return ["establish", "develop", "insert", "peak", "resolve"];

    case "escalation":
      if (cutCount === 2) return ["develop", "peak"];
      if (cutCount === 3) return ["develop", "insert", "peak"];
      if (cutCount === 4) return ["establish", "develop", "insert", "peak"];
      return ["establish", "develop", "insert", "peak", "resolve"];

    case "setup":
      if (cutCount === 2) return ["establish", "develop"];
      if (cutCount === 3) return ["establish", "develop", "resolve"];
      if (cutCount === 4) return ["establish", "develop", "insert", "resolve"];
      return ["establish", "develop", "insert", "transition", "resolve"];

    case "mechanism":
      if (cutCount === 2) return ["establish", "develop"];
      if (cutCount === 3) return ["establish", "develop", "peak"];
      if (cutCount === 4) return ["establish", "develop", "insert", "peak"];
      return ["establish", "develop", "insert", "peak", "resolve"];

    case "transition":
      if (cutCount === 2) return ["transition", "establish"];
      if (cutCount === 3) return ["transition", "establish", "develop"];
      if (cutCount === 4) return ["transition", "establish", "develop", "resolve"];
      return ["transition", "establish", "develop", "peak", "resolve"];

    default: // development
      if (cutCount === 2) return ["establish", "develop"];
      if (cutCount === 3) return ["establish", "develop", "resolve"];
      if (cutCount === 4) return ["establish", "develop", "peak", "resolve"];
      return ["establish", "transition", "develop", "peak", "resolve"];
  }
}

/** 컷 역할과 비트 타입에 따른 시각적 포커스 선택 */
function selectVisualFocus(
  role: ShotRole,
  beatType: SequenceBeatType,
  isFirst: boolean,
  isLast: boolean,
): CutVisualFocus {
  // 역사/교육 컨텐츠의 기본 시각 전략
  switch (role) {
    case "establish":
      return beatType === "hook" ? "spectacle" : "environment";
    case "develop":
      return beatType === "consequence" ? "contrast" : "action";
    case "insert":
      return "object-detail";
    case "peak":
      if (beatType === "paradox" || beatType === "reveal") return "concept";
      return "face";
    case "resolve":
      if (beatType === "consequence") return "aftermath";
      return isLast ? "aftermath" : "contrast";
    case "transition":
      return "environment";
    default:
      return "action";
  }
}

/** 이전 컷 → 현재 컷의 변화 설명 */
function describeCutChange(prevRole: ShotRole, currentRole: ShotRole, _beatType: SequenceBeatType): string {
  const changes: Record<string, string> = {
    "establish→develop": "공간에서 행동으로 — 주체가 등장하고 행동 시작",
    "establish→peak": "공간에서 클라이맥스로 — 급격한 텐션 점프",
    "develop→peak": "행동에서 절정으로 — 감정/갈등 최고점 도달",
    "develop→insert": "행동에서 디테일로 — 스케일 급격 변화",
    "develop→resolve": "행동에서 결과로 — 인과 관계 시각화",
    "insert→peak": "디테일에서 클라이맥스로 — 축적된 텐션 폭발",
    "peak→resolve": "절정에서 해소로 — 에너지 하강, 의미 착지",
    "establish→resolve": "공간에서 결과로 — 전후 대비",
    "develop→develop": "새로운 증거/논거 도입 — 정보 확장",
    "transition→develop": "시점 전환 후 새 정보 — 관찰 각도 변화",
  };
  const key = `${prevRole}→${currentRole}`;
  return changes[key] || `${prevRole}에서 ${currentRole}로 — 시각적 전환`;
}

/** 컷의 서사적 기능 설명 */
function describeNarrativeFunction(
  role: ShotRole,
  beatType: SequenceBeatType,
  isFirst: boolean,
  isLast: boolean,
): string {
  if (isFirst && beatType === "hook") return "시청자의 시선을 붙잡는 첫 이미지 — 스크롤 멈춤";
  if (isFirst) return "이 시퀀스의 시각적 컨텍스트 설정";

  switch (role) {
    case "develop":
      return "새로운 시각적 증거 도입 — 논거 확장";
    case "insert":
      return "핵심 디테일 극대화 — 텐션 상승 전 축적";
    case "peak":
      if (beatType === "reveal") return "충격적 정보 시각화 — '이걸 몰랐어?' 순간";
      if (beatType === "paradox") return "역설적 진실 시각화 — 기대 전복";
      return "감정/논리적 클라이맥스 — 최대 임팩트";
    case "resolve":
      if (isLast && beatType === "consequence") return "결과의 시각적 증거 — 인과 관계 완결";
      if (isLast) return "시각적 보상과 의미 착지";
      return "해소와 전환 — 다음 시퀀스로의 연결";
    default:
      return "시각적 정보 확장";
  }
}

/** 프롬프트 의도 생성 */
function generatePromptIntent(
  role: ShotRole,
  beatType: SequenceBeatType,
  beats: ScriptBeat[],
  _cutIndex: number,
  _totalCuts: number,
): string {
  // 비트 텍스트에서 핵심 주제 추출
  const combinedText = beats.map(b => b.text).join(" ");
  const topics = extractTopicKeywords(combinedText).slice(0, 3);
  const topicStr = topics.length > 0 ? topics.join(", ") : "주제";

  switch (role) {
    case "establish":
      if (beatType === "hook") return `${topicStr} — 시청자를 즉시 사로잡는 도발적/충격적 이미지`;
      return `${topicStr}의 시대/공간 — 넓은 환경 설정`;
    case "develop":
      return `${topicStr}의 핵심 메커니즘 시각화 — 행동/변화 포착`;
    case "insert":
      return `${topicStr}의 결정적 디테일 — 확대된 증거 또는 상징`;
    case "peak":
      if (beatType === "reveal") return `${topicStr}의 충격적 진실 — 최대 시각적 임팩트`;
      return `${topicStr}의 감정적/논리적 클라이맥스 — 가장 강렬한 프레임`;
    case "resolve":
      return `${topicStr}의 결과/여파 — 변화 이후의 정적 또는 새로운 현실`;
    case "transition":
      return `${topicStr} — 새로운 관점으로의 시각적 전환`;
    default:
      return `${topicStr} 시각화`;
  }
}

/** 시청 유지 이유 설명 */
function describeRetentionReason(
  role: ShotRole,
  beatType: SequenceBeatType,
  isFirst: boolean,
  isLast: boolean,
): string {
  if (isFirst) return "첫 프레임이 시각적 호기심을 유발 — '이게 뭐지?' 반응";

  switch (role) {
    case "develop": return "새로운 정보가 이전 이미지를 확장 — '그래서 어떻게?'";
    case "insert": return "스케일 변화가 주의를 집중 — '저건 뭐지?'";
    case "peak":
      if (beatType === "reveal") return "숨겨진 진실이 시각적으로 폭발 — '이걸 몰랐네!'";
      return "축적된 텐션이 최고점에 도달 — 시각적 보상";
    case "resolve":
      if (isLast) return "논점이 시각적으로 착지 — 감정적/지적 보상";
      return "해소 후 다음 시퀀스에 대한 기대감 형성";
    default: return "시각적 변화가 지루함 방지";
  }
}

// ═══════════════════════════════════════════════════════════════════
// Phase A: Fast Structural Analysis
// ═══════════════════════════════════════════════════════════════════

/**
 * Phase A — 빠른 구조 분석 (즉시 반환).
 *
 * 반환:
 *   - 매크로 분석 (hook, thesis, runtime, confidence, issues)
 *   - 시퀀스 스켈레톤 (title, beatType, duration, cutCount, endingMode)
 *   - 빈 cuts[] / stub strategies (Phase B에서 채움)
 *   - beats, sequenceGroups (Phase B에서 재사용)
 *
 * 캐시 히트 시: 이전 full analysis를 즉시 반환.
 */
export function analyzeScriptPhaseA(
  scriptText: string,
  options?: {
    targetRuntimeSec?: number;
    contentTypeHint?: ScriptContentType;
  },
): PhaseAResult {
  const text = scriptText.trim();
  const key = scriptHash(text);

  // Check full analysis cache — if available, return instantly
  const cached = fullAnalysisCache.get(key);
  if (cached) {
    const beats = beatCache.get(key) || parseScriptBeats(text);
    const groups = boundaryCache.get(key) || planSequenceBoundaries(beats);
    return { result: cached, beats, sequenceGroups: groups, cacheKey: key };
  }

  if (!text) {
    const empty: ScriptAnalysisResult = {
      sourceSummary: "",
      mainHook: "",
      thesis: "",
      totalSuggestedRuntime: 0,
      suggestedSequenceCount: 0,
      structuralNotes: [],
      weaknesses: [],
      issues: [{ code: "short_script", severity: "error", message: "대본 텍스트가 비어 있습니다.", suggestion: "분석할 대본을 입력해 주세요." }],
      confidence: "low",
      sequences: [],
    };
    return { result: empty, beats: [], sequenceGroups: [], cacheKey: key };
  }

  // 1. Beat parsing (cached)
  let beats = beatCache.get(key);
  if (!beats) {
    beats = parseScriptBeats(text);
    cacheSet(beatCache, key, beats);
  }

  // 2. Runtime
  const estimatedRuntime = options?.targetRuntimeSec
    ?? beats.reduce((sum, b) => sum + b.estimatedSec, 0);

  // 3. Sequence boundaries (cached)
  let sequenceGroups = boundaryCache.get(key);
  if (!sequenceGroups) {
    sequenceGroups = planSequenceBoundaries(beats);
    cacheSet(boundaryCache, key, sequenceGroups);
  }

  // 4. Skeleton sequences (title, beatType, duration, endingMode — NO cuts/strategies)
  let charOffset = 0;
  const sequences: AnalyzedSequence[] = sequenceGroups.map((seqBeats, seqIdx) => {
    const seqDuration = Math.min(
      SEQ_MAX_SEC,
      Math.max(SEQ_MIN_SEC, seqBeats.reduce((s, b) => s + b.estimatedSec, 0)),
    );

    const dominantBeat = seqBeats.reduce((best, b) =>
      b.intensity > best.intensity ? b : best, seqBeats[0]);
    const beatType = seqIdx === 0 ? "hook" as SequenceBeatType : dominantBeat.typeHint;

    const isLast = seqIdx === sequenceGroups!.length - 1;
    const endingMode: SequenceEndingMode = isLast
      ? "close"
      : beatType === "paradox" ? "paradox"
      : dominantBeat.typeHint === "transition" ? "transition"
      : dominantBeat.intensity > 0.5 ? "cliffhanger"
      : "loop-open";

    const seqSourceText = seqBeats.map(b => b.text).join(" ");
    const startChar = text.indexOf(seqBeats[0].text, charOffset);
    const lastBeatText = seqBeats[seqBeats.length - 1].text;
    const lastBeatStart = text.indexOf(lastBeatText, startChar >= 0 ? startChar : charOffset);
    const endChar = lastBeatStart >= 0 ? lastBeatStart + lastBeatText.length : startChar + seqSourceText.length;
    if (startChar >= 0) charOffset = endChar;

    const cutCount = recommendCutCount(seqDuration, beatType);

    return {
      id: seqIdx + 1,
      title: generateSequenceTitle(seqBeats, beatType, seqIdx),
      purpose: "",             // Phase B
      beatType,
      sourceText: seqSourceText,
      sourceSpan: startChar >= 0 ? { startChar, endChar } : undefined,
      recommendedDurationSec: seqDuration,
      recommendedCutCount: cutCount,
      rationale: "",           // Phase B
      endingMode,
      cliffhangerText: undefined, // Phase B
      retentionStrategy: { curiosityPoint: "", informationGain: "", escalation: "", payoff: "" },
      visualStrategy: { primaryDriver: "concept-reveal" as const, finalFrameLanding: "unresolved-curiosity" as const, toneHint: "" },
      cuts: [],                // Phase B
    };
  });

  // 5. Macro analysis
  const hookBeat = beats.find(b => b.typeHint === "hook") ?? beats[0];
  const thesis = extractThesis(beats);
  const summary = text.length > 200 ? text.slice(0, 200) + "…" : text;

  // 6. Quality analysis (runs on skeleton — issues/notes/weaknesses don't need cuts)
  const { notes, weaknesses, issues } = analyzeStructuralQuality(beats, sequences, text);
  const confidence = computeConfidence(beats, sequences, issues);

  const result: ScriptAnalysisResult = {
    sourceSummary: summary,
    mainHook: hookBeat?.text?.slice(0, 100) || "",
    thesis,
    totalSuggestedRuntime: Math.max(estimatedRuntime, sequences.reduce((s, seq) => s + seq.recommendedDurationSec, 0)),
    suggestedSequenceCount: sequences.length,
    structuralNotes: notes,
    weaknesses,
    issues,
    confidence,
    sequences,
  };

  return { result, beats, sequenceGroups, cacheKey: key };
}

// ═══════════════════════════════════════════════════════════════════
// Phase B: Per-Sequence Detail Enrichment
// ═══════════════════════════════════════════════════════════════════

/**
 * Phase B — 단일 시퀀스의 상세 정보를 채움.
 *
 * cuts[], purpose, rationale, retentionStrategy, visualStrategy, cliffhangerText.
 * Phase A의 skeleton sequence를 받아 enriched copy를 반환.
 */
export function enrichSequenceDetail(
  sequence: AnalyzedSequence,
  sequenceGroups: ScriptBeat[][],
  seqIdx: number,
  totalSeqs: number,
): AnalyzedSequence {
  const seqBeats = sequenceGroups[seqIdx];
  if (!seqBeats) return sequence;

  const beatType = sequence.beatType;
  const isLast = seqIdx === totalSeqs - 1;

  const cuts = generateCutProgression(seqBeats, sequence.recommendedDurationSec, beatType);
  const cliffhangerText = sequence.endingMode === "cliffhanger"
    ? generateCliffhangerText(seqBeats, beatType)
    : undefined;

  return {
    ...sequence,
    purpose: generateSequencePurpose(seqBeats, beatType),
    rationale: generateSequenceRationale(beatType, seqIdx, totalSeqs),
    cliffhangerText,
    retentionStrategy: generateRetentionStrategy(seqBeats, beatType, sequence.endingMode),
    visualStrategy: generateVisualStrategy(beatType, isLast),
    cuts,
    recommendedCutCount: cuts.length,
  };
}

/**
 * Phase B — 모든 시퀀스를 한번에 enrich (batch).
 *
 * Phase A 결과를 받아 모든 시퀀스에 상세 정보를 채움.
 * 결과를 full analysis cache에 저장.
 */
export function enrichAllSequences(phaseA: PhaseAResult): ScriptAnalysisResult {
  const { result, sequenceGroups, cacheKey } = phaseA;
  const totalSeqs = result.sequences.length;

  const enrichedSequences = result.sequences.map((seq, idx) =>
    enrichSequenceDetail(seq, sequenceGroups, idx, totalSeqs),
  );

  const enrichedResult: ScriptAnalysisResult = {
    ...result,
    sequences: enrichedSequences,
  };

  // Cache the full result
  cacheSet(fullAnalysisCache, cacheKey, enrichedResult);

  return enrichedResult;
}

// ═══════════════════════════════════════════════════════════════════
// Backward-Compatible Full Analysis
// ═══════════════════════════════════════════════════════════════════

/**
 * 대본 텍스트를 릴 시퀀스 프로덕션 구조로 분석.
 *
 * Backward-compatible: Phase A + Phase B를 순차 실행하여
 * 기존과 동일한 complete ScriptAnalysisResult를 반환.
 */
export function analyzeScript(
  scriptText: string,
  options?: {
    targetRuntimeSec?: number;
    contentTypeHint?: ScriptContentType;
  },
): ScriptAnalysisResult {
  const phaseA = analyzeScriptPhaseA(scriptText, options);
  return enrichAllSequences(phaseA);
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

/** 시퀀스 제목 생성 */
function generateSequenceTitle(beats: ScriptBeat[], beatType: SequenceBeatType, seqIndex: number): string {
  const topics = extractTopicKeywords(beats.map(b => b.text).join(" ")).slice(0, 2);
  const topicStr = topics.join("과 ");

  const titlePatterns: Partial<Record<SequenceBeatType, (t: string) => string>> = {
    hook: (t) => t ? `${t} — 강렬한 도입` : "강렬한 도입",
    setup: (t) => t ? `${t}의 배경` : "배경 설정",
    mechanism: (t) => t ? `${t}의 원리` : "핵심 원리",
    development: (t) => t ? `${t}의 전개` : "핵심 전개",
    reveal: (t) => t ? `${t}의 진실` : "숨겨진 진실",
    consequence: (t) => t ? `${t}이 바꾼 것` : "결과와 영향",
    escalation: (t) => t ? `${t}의 심화` : "텐션 상승",
    paradox: (t) => t ? `${t}의 역설` : "역설적 결론",
    payoff: (t) => t ? `${t}의 의미` : "최종 의미",
    transition: (t) => t ? `${t} — 전환` : "시점 전환",
  };

  return titlePatterns[beatType]?.(topicStr) || `시퀀스 ${seqIndex + 1}`;
}

/** 시퀀스 목적 생성 */
function generateSequencePurpose(beats: ScriptBeat[], beatType: SequenceBeatType): string {
  const purposes: Partial<Record<SequenceBeatType, string>> = {
    hook: "시청자의 스크롤을 멈추는 강렬한 도입 — 질문, 도발, 또는 약속",
    setup: "핵심 전제를 이해시키기 위한 배경과 컨텍스트 제공",
    mechanism: "어떻게 작동하는지의 원리와 메커니즘을 시각적으로 설명",
    development: "핵심 주장의 근거를 시각적으로 확장하며 정보 축적",
    reveal: "숨겨진 진실 또는 예상치 못한 정보를 충격적으로 공개",
    consequence: "원인에서 결과로 이어지는 인과 관계를 시각적으로 증명",
    escalation: "텐션을 점점 끌어올려 다음 시퀀스에 대한 기대 형성",
    paradox: "기대를 전복하는 역설적 결론으로 인지적 보상 제공",
    payoff: "축적된 서사의 최종 결론을 감정적/시각적으로 착지",
    transition: "시점이나 주제를 전환하며 새로운 관점 도입",
  };
  return purposes[beatType] || "시각적 정보 확장";
}

/** 시퀀스 존재 이유 생성 */
function generateSequenceRationale(beatType: SequenceBeatType, seqIndex: number, totalSeqs: number): string {
  if (seqIndex === 0) return "첫 시퀀스는 시청자를 즉시 사로잡아야 한다 — 가장 강력한 논점으로 시작";
  if (seqIndex === totalSeqs - 1) return "마지막 시퀀스는 축적된 논증을 착지시켜야 한다 — 감정적/지적 보상 제공";

  const rationales: Partial<Record<SequenceBeatType, string>> = {
    hook: "추가적인 호기심 유발이 필요한 지점",
    setup: "배경 없이는 이후 전개가 맥락을 잃음",
    mechanism: "원리 설명이 독립 시퀀스로 가야 이해도 상승",
    development: "핵심 전개 없이는 주장이 빈약 — 시각적 증거 필요",
    reveal: "정보 공개 시점을 분리하면 충격 극대화",
    consequence: "인과 관계를 별도 시퀀스로 분리하면 논리 선명도 상승",
    escalation: "텐션 상승이 다음 시퀀스의 임팩트를 증폭",
    paradox: "역설은 독립 시퀀스로 가야 인지적 충격 극대화",
    payoff: "최종 보상은 독립 시퀀스로 가야 여운 극대화",
    transition: "시점 전환이 별도 공간을 필요로 함",
  };
  return rationales[beatType] || "서사 전환이 별도 시각적 공간을 요구";
}

/** 리텐션 전략 생성 */
function generateRetentionStrategy(
  beats: ScriptBeat[],
  beatType: SequenceBeatType,
  endingMode: SequenceEndingMode,
): RetentionStrategy {
  return {
    curiosityPoint: (() => {
      switch (beatType) {
        case "hook": return "도발적 도입이 '정말?' 반응 유발";
        case "setup": return "배경 설정이 '왜 이게 중요하지?' 호기심 유발";
        case "mechanism": return "원리 설명이 '어떻게 가능하지?' 궁금증 유발";
        case "reveal": return "충격적 정보 공개 직전의 서스펜스";
        case "paradox": return "상식과 반대되는 결론 예고";
        case "transition": return "새로운 시점이 '이건 또 뭐지?' 호기심 유발";
        default: return "새로운 정보가 기존 인식을 확장";
      }
    })(),
    informationGain: beats.length > 1
      ? `${beats.length}개 논점이 순차적으로 정보량 증가`
      : "단일 핵심 논점의 깊이 확장",
    escalation: (() => {
      switch (beatType) {
        case "hook": return "첫 프레임부터 최대 강도 — 이후 점진적 설명";
        case "escalation": return "각 컷마다 강도 상승 — 텐션 누적";
        case "reveal": return "숨김 → 힌트 → 공개 순서로 임팩트 극대화";
        default: return "정보 축적을 통한 점진적 이해 심화";
      }
    })(),
    payoff: (() => {
      if (endingMode === "cliffhanger") return "이 시퀀스는 의도적으로 미완 — 다음 시퀀스가 보상";
      if (endingMode === "loop-open") return "연결 고리를 열어둬 연속 시청 유도";
      return "논점이 시각적으로 완결 — 감정적/지적 보상 착지";
    })(),
  };
}

/** 시각적 전략 생성 */
function generateVisualStrategy(beatType: SequenceBeatType, isLast: boolean): VisualStrategy {
  const driverMap: Partial<Record<SequenceBeatType, VisualStrategy["primaryDriver"]>> = {
    hook: "spectacle",
    setup: "atmosphere",
    mechanism: "concept-reveal",
    development: "concept-reveal",
    reveal: "concept-reveal",
    consequence: "contrast",
    escalation: "emotion",
    paradox: "contrast",
    payoff: "emotion",
    transition: "atmosphere",
  };

  const landingMap: Partial<Record<SequenceBeatType, VisualStrategy["finalFrameLanding"]>> = {
    hook: "unresolved-curiosity",
    setup: "unresolved-curiosity",
    mechanism: "unresolved-curiosity",
    development: "unresolved-curiosity",
    reveal: "reaction",
    consequence: "payoff",
    escalation: "unresolved-curiosity",
    paradox: "payoff",
    payoff: "payoff",
    transition: "unresolved-curiosity",
  };

  const toneMap: Partial<Record<SequenceBeatType, string>> = {
    hook: "강렬하고 시선을 사로잡는",
    setup: "차분하지만 기대감을 조성하는",
    mechanism: "정밀하고 설명적인",
    development: "정보가 확장되며 시각적으로 풍부한",
    reveal: "서스펜스에서 충격으로 전환하는",
    consequence: "원인과 결과의 대비가 선명한",
    escalation: "점점 긴장감이 고조되는",
    paradox: "기대를 전복하는 반전의",
    payoff: "감정적 여운이 남는",
    transition: "새로운 시점으로 전환하는",
  };

  return {
    primaryDriver: driverMap[beatType] || "concept-reveal",
    finalFrameLanding: isLast ? "payoff" : (landingMap[beatType] || "unresolved-curiosity"),
    toneHint: toneMap[beatType] || "시각적으로 풍부한",
  };
}

/** 대본에서 핵심 thesis 추출 */
function extractThesis(beats: ScriptBeat[]): string {
  // 가장 강도가 높은 비트의 핵심 문장
  const strongest = [...beats].sort((a, b) => b.intensity - a.intensity)[0];
  if (!strongest) return "";

  // 첫 문장 추출
  const firstSentence = strongest.text.split(/[.!?…]/)[0]?.trim();
  return firstSentence || strongest.text.slice(0, 80);
}

/** 구조 품질 분석 — issues[] 기반 */
function analyzeStructuralQuality(
  beats: ScriptBeat[],
  sequences: AnalyzedSequence[],
  fullText: string,
): { notes: string[]; weaknesses: string[]; issues: ScriptAnalysisIssue[] } {
  const notes: string[] = [];
  const weaknesses: string[] = [];
  const issues: ScriptAnalysisIssue[] = [];

  // 비트 수 분석
  if (beats.length >= 3) notes.push(`${beats.length}개 서사 비트 감지 — 충분한 구조적 깊이`);
  if (beats.length < 3) {
    weaknesses.push("서사 비트가 3개 미만 — 더 많은 논점 분리 필요");
    issues.push({ code: "short_script", severity: "warning", message: "서사 비트가 3개 미만 — 구조적 깊이 부족", suggestion: "더 많은 논점이나 전환 포인트를 추가하세요." });
  }

  // 훅 강도 분석
  const hookBeat = beats[0];
  if (hookBeat && hookBeat.intensity > 0.5) notes.push("강력한 훅 감지 — 시선 포착력 우수");
  if (hookBeat && hookBeat.intensity < 0.3) {
    weaknesses.push("훅이 약함 — 더 도발적인 첫 문장 필요");
    issues.push({ code: "weak_hook", severity: "warning", message: "첫 문장의 훅이 약합니다 — 스크롤 멈춤 효과 부족", suggestion: "도발적 질문, 충격적 사실, 또는 상식 전복으로 시작하세요." });
  }

  // 시퀀스 밸런스 분석
  const durations = sequences.map(s => s.recommendedDurationSec);
  const avgDuration = durations.reduce((s, d) => s + d, 0) / Math.max(1, durations.length);
  if (avgDuration >= SEQ_MIN_SEC && avgDuration <= SEQ_MAX_SEC) {
    notes.push(`평균 시퀀스 ${Math.round(avgDuration)}초 — 적절한 밸런스`);
  }

  // 결론 존재 여부
  const hasConclusion = beats.some(b => b.typeHint === "payoff" || b.typeHint === "paradox");
  if (hasConclusion) notes.push("결론/역설 비트 존재 — 착지 가능");
  if (!hasConclusion) {
    weaknesses.push("명확한 결론/역설 부재 — 착지점 보강 필요");
    issues.push({ code: "weak_payoff", severity: "warning", message: "명확한 결론 또는 역설적 착지가 없습니다.", suggestion: "마지막 비트에 핵심 메시지의 감정적/논리적 착지를 추가하세요." });
  }

  // 텍스트 밀도 체크
  const charCount = fullText.replace(/\s/g, "").length;
  const charsPerSeq = charCount / Math.max(1, sequences.length);
  if (charsPerSeq > 200) {
    weaknesses.push("시퀀스당 텍스트 밀도가 높음 — 시퀀스를 더 분리하거나 내용 축약 고려");
    issues.push({ code: "too_dense", severity: "warning", message: `시퀀스당 평균 ${Math.round(charsPerSeq)}자 — 밀도가 높습니다.`, suggestion: "시퀀스를 더 세분화하거나 내용을 축약하세요." });
  }

  // 반복 패턴 감지
  const beatTypes = beats.map(b => b.typeHint);
  const consecutiveSame = beatTypes.some((t, i) => i > 0 && t === beatTypes[i - 1] && t === "development");
  if (consecutiveSame) {
    weaknesses.push("development 비트가 연속 — 중간에 reveal 또는 escalation 삽입 고려");
    issues.push({ code: "too_repetitive", severity: "info", message: "동일한 비트 타입(development)이 연속됩니다.", suggestion: "중간에 reveal, escalation, 또는 consequence를 삽입하면 리듬이 좋아집니다." });
  }

  // 비트 타입 다양성 체크
  const uniqueBeatTypes = new Set(beatTypes);
  if (beats.length >= 4 && uniqueBeatTypes.size <= 2) {
    issues.push({ code: "single_beat_type", severity: "info", message: "비트 타입이 단조롭습니다 — 서사 리듬 개선 필요", suggestion: "다른 비트 타입(reveal, escalation, paradox 등)을 활용하세요." });
  }

  // 시퀀스 과부하 체크
  if (sequences.length > 8) {
    issues.push({ code: "sequence_overload", severity: "info", message: `${sequences.length}개 시퀀스 — 숏폼 릴 기준 다소 많습니다.`, suggestion: "핵심 논점을 압축하거나 시리즈 분할을 고려하세요." });
  }

  return { notes, weaknesses, issues };
}

/** 분석 신뢰도 계산 */
function computeConfidence(
  beats: ScriptBeat[],
  sequences: AnalyzedSequence[],
  issues: ScriptAnalysisIssue[],
): AnalysisConfidence {
  const errorCount = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;

  if (errorCount > 0 || beats.length < 2) return "low";
  if (warningCount >= 3 || sequences.length < 2) return "medium";
  if (beats.length >= 4 && warningCount === 0) return "high";
  return "medium";
}

/** 클리프행어 텍스트 생성 */
function generateCliffhangerText(beats: ScriptBeat[], beatType: SequenceBeatType): string {
  const lastBeat = beats[beats.length - 1];
  const topics = extractTopicKeywords(lastBeat.text).slice(0, 2);
  const topicStr = topics.join(", ") || "다음 이야기";

  switch (beatType) {
    case "hook": return `그렇다면 ${topicStr}는 어떻게 된 걸까?`;
    case "reveal": return `하지만 진짜 충격적인 건 따로 있다...`;
    case "escalation": return `그리고 상황은 더 심각해진다...`;
    case "consequence": return `그 결과는 아무도 예상하지 못했다...`;
    default: return `${topicStr}의 진짜 이야기는 지금부터다...`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Runtime Estimation
// ═══════════════════════════════════════════════════════════════════

/**
 * 대본 텍스트의 총 런타임을 추정.
 * Korean-specific pacing model with punctuation pauses,
 * proper noun overhead, and visual breathing room.
 *
 * @see narration-timing.ts for the full pacing model
 */
export function estimateRuntime(scriptText: string): number {
  return estimateNarrationRuntime(scriptText);
}

// ═══════════════════════════════════════════════════════════════════
// Conversion to Existing Cut[] Structure
// ═══════════════════════════════════════════════════════════════════

/**
 * 분석된 시퀀스를 기존 Cut[] 구조로 변환.
 *
 * 이 함수는 ScriptAnalyzerPanel에서 "적용" 버튼을 누를 때 호출되어
 * 기존 ResultPanel/CutCard 워크플로우에 바로 투입할 수 있는 구조를 생성.
 */
export function convertToCuts(analysis: ScriptAnalysisResult): Cut[] {
  const safe = normalizeAnalysisResult(analysis);
  const cuts: Cut[] = [];
  let cutNumber = 1;

  for (const seq of safe.sequences) {
    const seqCuts = safeArray<AnalyzedCut>(seq.cuts);
    const dur = safeNumber(seq.recommendedDurationSec, 8);
    const cutCount = Math.max(1, seqCuts.length);

    cuts.push({
      cutNumber: cutNumber++,
      durationSec: dur,
      sceneDescription: `[${safeString(seq.title)}] ${safeString(seq.purpose)}`,
      cameraDirection: deriveCameraDirection(seq),
      moodLighting: deriveMoodLighting(seq),
      imagePrompt: "",
      endImagePrompt: "",
      videoPrompt: seqCuts.map(c => safeString(c.suggestedPromptIntent)).filter(Boolean).join(". ") || safeString(seq.title),
      extendPrompt: "",
      transitionHint: seq.endingMode === "cliffhanger" ? "서스펜스 유지" : "자연 전환",
      characterConsistency: "",
      charactersInScene: [],
      shotCategory: "character-driven",
      multiShot: seqCuts.length > 0
        ? seqCuts.map((cut, i) => ({
            index: i + 1,
            prompt: safeString(cut.suggestedPromptIntent) || safeString(seq.title),
            duration: String(Math.max(2, Math.round(dur / cutCount))),
            role: cut.role || "develop" as ShotRole,
          }))
        : undefined,
    });
  }

  return cuts;
}

/** 시퀀스에서 카메라 방향 도출 */
function deriveCameraDirection(seq: AnalyzedSequence): string {
  const focus = seq.visualStrategy.primaryDriver;
  switch (focus) {
    case "spectacle": return "Wide establishing → dramatic reveal";
    case "emotion": return "Medium to close-up — emotional intensity";
    case "contrast": return "Juxtaposition cuts — before/after";
    case "concept-reveal": return "Build-up to reveal — visual metaphor";
    case "atmosphere": return "Slow pan across environment";
    default: return "Dynamic progression";
  }
}

/** 시퀀스에서 조명/분위기 도출 */
function deriveMoodLighting(seq: AnalyzedSequence): string {
  switch (seq.beatType) {
    case "hook": return "High contrast, dramatic shadows — immediate attention";
    case "setup": return "Soft ambient, establishing tone — context building";
    case "mechanism": return "Clean, precise lighting — clarity and detail";
    case "development": return "Neutral, informative lighting — clarity";
    case "reveal": return "Building darkness to sudden light — reveal moment";
    case "consequence": return "Muted, somber tones — weight of impact";
    case "escalation": return "Increasingly warm/red tones — tension";
    case "paradox": return "Cold then warm — expectation reversal";
    case "payoff": return "Golden hour / warm resolution — emotional payoff";
    case "transition": return "Shifting light — perspective change";
    default: return "Natural lighting";
  }
}

// ═══════════════════════════════════════════════════════════════════
// Content Type Detection
// ═══════════════════════════════════════════════════════════════════

/**
 * 대본 텍스트의 컨텐츠 타입을 자동 감지.
 */
export function detectContentType(scriptText: string): ScriptContentType {
  const text = scriptText.toLowerCase();

  // 반사실/가정법 — 높은 우선순위 (만약/없었다면 등이 있으면 what-if가 주 장르)
  if (/(?:만약|않았다면|없었다면|했더라면|가정|what\s*if|대안|다른\s*길|평행)/.test(text)) return "what-if";
  // 역사 관련 키워드
  if (/(?:세기|왕조|전쟁|제국|혁명|왕|황제|식민|독립|고대|중세|근대|역사|시대|문명)/.test(text)) return "history";
  // 경제 관련 키워드
  if (/(?:경제|자본|노동|화폐|시장|무역|GDP|인플레|물가|임금|산업|투자|금융)/.test(text)) return "economics";
  // 사회 비평
  if (/(?:사회|불평등|계층|권력|정치|민주|자유|인권|차별|갈등|제도)/.test(text)) return "social-commentary";

  return "educational";
}

// ═══════════════════════════════════════════════════════════════════
// LLM Prompt Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * Server-side LLM 분석을 위한 프롬프트 구성.
 *
 * generate-cuts.ts와 동일한 패턴으로 구조화된 JSON 출력을 요청.
 */
export function buildAnalysisPrompt(
  scriptText: string,
  contentType: ScriptContentType,
  targetRuntimeSec?: number,
): string {
  const runtimeHint = targetRuntimeSec
    ? `목표 총 런타임: ${targetRuntimeSec}초`
    : "총 런타임은 내용에 맞게 자동 결정";

  return `당신은 숏폼 릴 시퀀스 프로덕션 전문가입니다.

아래 한국어 대본/나레이션을 분석하여 릴 시리즈 프로덕션 구조로 변환하세요.
이것은 요약이 아닙니다. 프로덕션 구조 변환입니다.

## 규칙
1. 텍스트를 문장 수나 길이로 나누지 마세요. 서사 비트 전환을 기준으로 시퀀스를 분리하세요.
2. 각 시퀀스는 8-15초 분량이어야 합니다. ${runtimeHint}.
3. 각 시퀀스 내부에 2-6개의 컷 프로그레션을 설계하세요.
4. 모든 컷은 존재 이유가 있어야 합니다. 가짜 분할 금지.
5. 주제/도메인에 관계없이 서사 구조를 분석하세요 (역사, 경제, 브랜드, 인물, 코미디, 감정 등 모두 적용).

## 컨텐츠 타입: ${contentType}

## 시퀀스 경계 결정 기준
- 비트 전환 (논점/감정/시점 변화)
- 원인→결과 전환
- 정보 공개/충격/반전 포인트
- 시청 리텐션 최적 pause 지점
- 한 시퀀스 = 하나의 미니 이벤트, 미니 논증, 또는 감정 단위

## 각 시퀀스의 비트 타입
- hook: 강렬한 도입 — 스크롤 멈춤 (질문, 도발, 약속)
- setup: 배경/전제 설정 — 컨텍스트 제공
- mechanism: 원리/메커니즘 설명 — 어떻게 작동하는가
- development: 핵심 전개 — 정보 축적과 논거 확장
- reveal: 충격적 정보 공개 — "wait, what?"
- consequence: 결과/영향 — 인과 관계
- escalation: 텐션 상승 — 점점 심각/강렬해짐
- paradox: 역설적 결론 — 기대 전복
- payoff: 최종 보상 — 감정적/논리적 클로징
- transition: 시점/주제 전환 — 새로운 관점 도입

## 구조적 이슈 감지
issues 배열에 다음 코드로 문제를 보고하세요:
- weak_hook: 첫 문장의 훅이 약함
- too_dense: 시퀀스당 텍스트 밀도가 높음
- too_repetitive: 같은 패턴 반복
- too_abstract: 구체적 이미지/사례 부족
- sequence_overload: 시퀀스가 너무 많음
- weak_payoff: 결론/착지가 약함
- unclear_boundary: 시퀀스 경계가 모호
- single_beat_type: 비트 타입이 단조로움
- short_script: 대본이 너무 짧음

## 출력 형식 (반드시 JSON)
{
  "sourceSummary": "1-2문장 핵심 요약",
  "mainHook": "가장 강력한 훅 문장",
  "thesis": "핵심 논제/전제",
  "totalSuggestedRuntime": 숫자(초),
  "suggestedSequenceCount": 숫자,
  "structuralNotes": ["잘 된 점1", ...],
  "weaknesses": ["약점1", ...],
  "issues": [{"code": "이슈코드", "severity": "info|warning|error", "message": "설명", "suggestion": "개선 제안"}],
  "confidence": "low|medium|high",
  "sequences": [
    {
      "id": 1,
      "title": "시퀀스 제목",
      "purpose": "한 줄 목적",
      "beatType": "hook|setup|mechanism|development|reveal|consequence|escalation|paradox|payoff|transition",
      "sourceText": "해당 원문 구간",
      "sourceSpan": {"startChar": 0, "endChar": 100},
      "recommendedDurationSec": 숫자(8-15),
      "recommendedCutCount": 숫자(2-6),
      "rationale": "존재 이유",
      "endingMode": "close|cliffhanger|loop-open|payoff|paradox|transition",
      "cliffhangerText": "클리프행어 시 예고 텍스트 (optional)",
      "retentionStrategy": {
        "curiosityPoint": "호기심 생성 지점",
        "informationGain": "정보 증가 지점",
        "escalation": "에스컬레이션 지점",
        "payoff": "보상 지점"
      },
      "visualStrategy": {
        "primaryDriver": "spectacle|emotion|reaction|concept-reveal|contrast|atmosphere",
        "finalFrameLanding": "payoff|reaction|unresolved-curiosity",
        "toneHint": "톤 설명"
      },
      "cuts": [
        {
          "role": "establish|develop|peak|resolve|insert|transition",
          "visualFocus": "environment|action|face|emotion|aftermath|object-detail|contrast|spectacle|concept|concept-reveal|reaction",
          "changeFromPrevious": "변화 설명",
          "narrativeFunction": "서사 기능",
          "suggestedPromptIntent": "프롬프트 의도",
          "retentionReason": "시청 유지 이유"
        }
      ]
    }
  ]
}

## 대본:
${scriptText}

반드시 위 JSON 형식으로만 응답하세요. 설명이나 마크다운 없이 순수 JSON만 출력하세요.`;
}
