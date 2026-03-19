/**
 * analyze-story-intent.ts — 스토리 의도 추출
 *
 * 규칙 기반. LLM 호출 없음. 키워드 감지 + 구조 분석.
 * 실패 시 neutral defaults 반환.
 */

import type { StoryIntentAnalysis, Tone, Pacing, Genre } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Safe Defaults
// ═══════════════════════════════════════════════════════════════════

export const SAFE_STORY_INTENT: StoryIntentAnalysis = {
  tone: "neutral",
  pacing: "moderate",
  genre: "general",
  emotionalArc: "steady",
  protagonistFocus: "medium",
  keyMotifs: [],
};

// ═══════════════════════════════════════════════════════════════════
// Keyword Maps
// ═══════════════════════════════════════════════════════════════════

const TONE_SIGNALS: Array<{ pattern: RegExp; tone: Tone }> = [
  { pattern: /공포|호러|악몽|저주|귀신|유령|피|시체|horror|nightmare/i, tone: "dark" },
  { pattern: /코미디|웃|유머|개그|comedy|funny|hilarious/i, tone: "playful" },
  { pattern: /풍자|비꼬|아이러니|역설|satir|ironi/i, tone: "satirical" },
  { pattern: /따뜻|감동|희망|사랑|warm|heartfelt|hopeful/i, tone: "warm" },
  { pattern: /진지|심각|무거|비극|tragic|serious|solemn/i, tone: "serious" },
];

const GENRE_SIGNALS: Array<{ pattern: RegExp; genre: Genre }> = [
  { pattern: /역사|왕조|제국|전쟁|세기|년대|histor/i, genre: "historical" },
  { pattern: /공포|호러|악몽|저주|horror|nightmare/i, genre: "horror" },
  { pattern: /코미디|웃|유머|comedy|funny/i, genre: "comedy" },
  { pattern: /다큐|실제|사실|documenta|real/i, genre: "documentary" },
  { pattern: /액션|전투|폭발|추격|action|battle|explosion/i, genre: "action" },
  { pattern: /사랑|연인|키스|고백|romance|love/i, genre: "romance" },
  { pattern: /긴장|추리|살인|범인|thriller|suspense|murder/i, genre: "thriller" },
  { pattern: /극|드라마|갈등|drama|conflict/i, genre: "drama" },
  { pattern: /판타지|마법|용|엘프|fantasy|magic/i, genre: "fantasy" },
];

const MOTIF_EXTRACTORS: Array<{ pattern: RegExp; motif: string }> = [
  { pattern: /고독|외로|혼자|solitud|alone|lonely/i, motif: "isolation" },
  { pattern: /추락|몰락|하락|fall|decline|collapse/i, motif: "downfall" },
  { pattern: /부활|재기|회복|rebirth|revival|recovery/i, motif: "resurrection" },
  { pattern: /대비|대조|명암|contrast|duality/i, motif: "contrast" },
  { pattern: /시간|세월|흐름|time|passage|aging/i, motif: "passage of time" },
  { pattern: /권력|지배|통제|power|control|dominat/i, motif: "power" },
  { pattern: /자유|해방|탈출|freedom|liberation|escape/i, motif: "freedom" },
  { pattern: /정의|복수|심판|justice|revenge|judgment/i, motif: "justice" },
];

// ═══════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════

export function analyzeStoryIntent(
  storyText: string,
  totalDurationSec: number,
  cutCount: number,
): StoryIntentAnalysis {
  try {
    if (!storyText || storyText.trim().length < 10) return SAFE_STORY_INTENT;

    const text = storyText.trim();

    // Tone
    const tone = detectFirst(text, TONE_SIGNALS, "tone", "neutral" as Tone);

    // Genre
    const genre = detectFirst(text, GENRE_SIGNALS, "genre", "general" as Genre);

    // Pacing — duration/cutCount ratio + text density
    const pacing = inferPacing(text, totalDurationSec, cutCount);

    // Emotional arc — sentence-level intensity curve
    const emotionalArc = inferEmotionalArc(text);

    // Protagonist focus — character mention density
    const protagonistFocus = inferProtagonistFocus(text);

    // Key motifs — max 3
    const keyMotifs = MOTIF_EXTRACTORS
      .filter(m => m.pattern.test(text))
      .map(m => m.motif)
      .slice(0, 3);

    return { tone, pacing, genre, emotionalArc, protagonistFocus, keyMotifs };
  } catch {
    return SAFE_STORY_INTENT;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function detectFirst<T>(
  text: string,
  signals: Array<{ pattern: RegExp; [key: string]: unknown }>,
  valueKey: string,
  fallback: T,
): T {
  for (const signal of signals) {
    if (signal.pattern.test(text)) return signal[valueKey] as T;
  }
  return fallback;
}

function inferPacing(text: string, totalDurationSec: number, cutCount: number): Pacing {
  if (cutCount <= 0 || totalDurationSec <= 0) return "moderate";
  const secPerCut = totalDurationSec / cutCount;

  // 문장당 글자 수로 정보 밀도 추정
  const sentences = text.split(/[.!?。\n]+/).filter(s => s.trim().length > 3);
  const avgSentenceLen = sentences.length > 0
    ? text.length / sentences.length
    : text.length;

  // 짧은 컷 + 높은 정보 밀도 = fast
  if (secPerCut <= 5 && avgSentenceLen < 30) return "fast";
  if (secPerCut <= 5) return "accelerating";
  if (secPerCut >= 10 && avgSentenceLen > 60) return "slow";
  if (secPerCut >= 8) return "decelerating";
  return "moderate";
}

function inferEmotionalArc(text: string): string {
  const sentences = text.split(/[.!?。\n]+/).filter(s => s.trim().length > 3);
  if (sentences.length < 3) return "steady";

  const third = Math.ceil(sentences.length / 3);
  const parts = [
    sentences.slice(0, third).join(" "),
    sentences.slice(third, third * 2).join(" "),
    sentences.slice(third * 2).join(" "),
  ];

  const intensityWords = /갈등|위기|충돌|폭발|절정|긴장|분노|두려|conflict|crisis|explosion|climax|tension|rage|fear/i;
  const calmWords = /평화|차분|고요|시작|소개|peace|calm|quiet|introduction/i;
  const resolutionWords = /해결|결말|마무리|희망|교훈|resolv|conclusion|ending|hope|lesson/i;

  const labels = parts.map(p => {
    if (intensityWords.test(p)) return "tension";
    if (resolutionWords.test(p)) return "resolution";
    if (calmWords.test(p)) return "calm";
    return "steady";
  });

  return labels.join(" → ");
}

function inferProtagonistFocus(text: string): "high" | "medium" | "low" {
  // 인물 관련 키워드 밀도
  const charSignals = /그[녀는가의]|그녀|인물|주인공|캐릭터|남자|여자|왕|의사|장군|he |she |character|protagonist/gi;
  const matches = text.match(charSignals) || [];
  const density = matches.length / Math.max(1, text.length / 100);

  if (density > 1.5) return "high";
  if (density > 0.5) return "medium";
  return "low";
}
