/**
 * _deep-analysis.ts — Deep Analysis standard-lite 서버 번들
 *
 * src/lib/deep-analysis/* 와 동일한 로직의 서버용 self-contained 모듈.
 * Cloudflare Pages Functions에서 @/ alias를 사용할 수 없으므로 단일 파일로 번들.
 *
 * 원칙: generate-cuts 품질 개선에 직접 연결되는 얇은 제어 레이어.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

type Tone = "serious" | "playful" | "dark" | "warm" | "neutral" | "satirical";
type Pacing = "slow" | "moderate" | "fast" | "accelerating" | "decelerating";
type Genre = "drama" | "horror" | "comedy" | "documentary" | "action" | "romance" | "thriller" | "historical" | "fantasy" | "general";
type RiskLevel = "low" | "medium" | "high";
type DensityLevel = "sparse" | "moderate" | "dense";
type EnergyLevel = "calm" | "moderate" | "dynamic";

export interface StoryIntentAnalysis {
  tone: Tone;
  pacing: Pacing;
  genre: Genre;
  emotionalArc: string;
  protagonistFocus: "high" | "medium" | "low";
  keyMotifs: string[];
}

export interface GenerationRiskAnalysis {
  continuityRisk: RiskLevel;
  subjectCountRisk: RiskLevel;
  sceneSwitchRisk: RiskLevel;
  motionComplexityRisk: RiskLevel;
  promptOverloadRisk: RiskLevel;
  visualAmbiguityRisk: RiskLevel;
  mitigationNotes: string[];
}

export interface VisualStrategyLite {
  visualDensity: DensityLevel;
  cameraEnergy: EnergyLevel;
  realismLevel: number;
  stylizationLevel: number;
  characterPriority: "high" | "medium" | "low";
  environmentPriority: "high" | "medium" | "low";
}

export interface PromptBrief {
  creativeBrief: string;
  continuityHint: string;
  shotDiscipline: string;
  subjectLockHint: string;
  environmentLockHint: string;
  avoidList: string[];
}

export interface DeepAnalysisResult {
  storyIntent: StoryIntentAnalysis;
  generationRisk: GenerationRiskAnalysis;
  visualStrategy: VisualStrategyLite;
  promptBrief: PromptBrief;
  analysisMs: number;
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Safe Defaults
// ═══════════════════════════════════════════════════════════════════

const SAFE_INTENT: StoryIntentAnalysis = { tone: "neutral", pacing: "moderate", genre: "general", emotionalArc: "steady", protagonistFocus: "medium", keyMotifs: [] };
const SAFE_RISK: GenerationRiskAnalysis = { continuityRisk: "medium", subjectCountRisk: "low", sceneSwitchRisk: "medium", motionComplexityRisk: "low", promptOverloadRisk: "low", visualAmbiguityRisk: "low", mitigationNotes: [] };
const SAFE_VISUAL: VisualStrategyLite = { visualDensity: "moderate", cameraEnergy: "moderate", realismLevel: 60, stylizationLevel: 40, characterPriority: "medium", environmentPriority: "medium" };
const SAFE_BRIEF: PromptBrief = { creativeBrief: "", continuityHint: "", shotDiscipline: "", subjectLockHint: "", environmentLockHint: "", avoidList: [] };

// ═══════════════════════════════════════════════════════════════════
// Story Intent
// ═══════════════════════════════════════════════════════════════════

function analyzeStoryIntent(text: string, totalSec: number, cuts: number): StoryIntentAnalysis {
  if (!text || text.length < 10) return SAFE_INTENT;

  const toneSignals: Array<{ p: RegExp; v: Tone }> = [
    { p: /공포|호러|악몽|저주|horror|nightmare/i, v: "dark" },
    { p: /코미디|웃|유머|comedy|funny/i, v: "playful" },
    { p: /풍자|비꼬|아이러니|satir|ironi/i, v: "satirical" },
    { p: /따뜻|감동|희망|warm|heartfelt/i, v: "warm" },
    { p: /진지|심각|비극|tragic|serious/i, v: "serious" },
  ];
  const tone = toneSignals.find(s => s.p.test(text))?.v ?? "neutral";

  const genreSignals: Array<{ p: RegExp; v: Genre }> = [
    { p: /역사|왕조|제국|세기|년대|histor/i, v: "historical" },
    { p: /공포|호러|horror/i, v: "horror" },
    { p: /코미디|comedy/i, v: "comedy" },
    { p: /다큐|documenta/i, v: "documentary" },
    { p: /액션|전투|action|battle/i, v: "action" },
    { p: /사랑|연인|romance|love/i, v: "romance" },
    { p: /긴장|추리|thriller|suspense/i, v: "thriller" },
    { p: /판타지|마법|fantasy|magic/i, v: "fantasy" },
    { p: /극|드라마|drama/i, v: "drama" },
  ];
  const genre = genreSignals.find(s => s.p.test(text))?.v ?? "general";

  // Pacing
  const secPerCut = cuts > 0 ? totalSec / cuts : totalSec;
  const pacing: Pacing = secPerCut <= 5 ? "fast" : secPerCut >= 10 ? "slow" : "moderate";

  // Emotional arc
  const sents = text.split(/[.!?。\n]+/).filter(s => s.trim().length > 3);
  let emotionalArc = "steady";
  if (sents.length >= 3) {
    const third = Math.ceil(sents.length / 3);
    const intensity = /갈등|위기|폭발|절정|긴장|conflict|crisis|climax|tension/i;
    const calm = /평화|차분|시작|peace|calm|introduction/i;
    const labels = [sents.slice(0, third), sents.slice(third, third * 2), sents.slice(third * 2)]
      .map(p => {
        const j = p.join(" ");
        if (intensity.test(j)) return "tension";
        if (calm.test(j)) return "calm";
        return "steady";
      });
    emotionalArc = labels.join(" → ");
  }

  // Protagonist focus
  const charSignals = text.match(/그[녀는가]|인물|주인공|캐릭터|he |she |character|protagonist/gi) || [];
  const density = charSignals.length / Math.max(1, text.length / 100);
  const protagonistFocus: "high" | "medium" | "low" = density > 1.5 ? "high" : density > 0.5 ? "medium" : "low";

  // Key motifs
  const motifExtractors: Array<{ p: RegExp; m: string }> = [
    { p: /고독|외로|혼자|solitud|alone/i, m: "isolation" },
    { p: /추락|몰락|fall|decline/i, m: "downfall" },
    { p: /권력|지배|power|control/i, m: "power" },
    { p: /자유|해방|freedom|liberation/i, m: "freedom" },
    { p: /시간|세월|time|passage/i, m: "passage of time" },
  ];
  const keyMotifs = motifExtractors.filter(m => m.p.test(text)).map(m => m.m).slice(0, 3);

  return { tone, pacing, genre, emotionalArc, protagonistFocus, keyMotifs };
}

// ═══════════════════════════════════════════════════════════════════
// Generation Risk
// ═══════════════════════════════════════════════════════════════════

function analyzeGenerationRisk(text: string, totalSec: number, cuts: number, charCount: number, contMode: boolean): GenerationRiskAnalysis {
  if (!text || text.length < 10) return SAFE_RISK;
  const notes: string[] = [];

  const continuityRisk: RiskLevel = contMode ? "low" : totalSec > 60 && cuts > 6 ? "high" : totalSec > 30 && cuts > 4 ? "medium" : "low";
  if (continuityRisk === "high") notes.push("lock subject appearance and lighting across all cuts");

  const personSignals = (text.match(/그리고\s*(다른|새로운)|meanwhile|another|새 인물/gi) || []).length;
  const total = charCount + personSignals;
  const subjectCountRisk: RiskLevel = total > 4 ? "high" : total > 2 ? "medium" : "low";
  if (subjectCountRisk === "high") notes.push("limit to max 2 subjects per cut");

  const switches = (text.match(/한편|다른\s*곳|meanwhile|elsewhere|이동|떠나/gi) || []).length;
  const switchDensity = cuts > 0 ? switches / cuts : 0;
  const sceneSwitchRisk: RiskLevel = switchDensity > 0.6 ? "high" : switchDensity > 0.3 ? "medium" : "low";
  if (sceneSwitchRisk === "high") notes.push("group related scenes and avoid abrupt resets");

  const complexMotion = (text.match(/폭발|추격|전투|격투|explosion|chase|battle|fight/gi) || []).length;
  const motionComplexityRisk: RiskLevel = complexMotion > 4 ? "high" : complexMotion > 2 ? "medium" : "low";

  const charsPerCut = cuts > 0 ? text.length / cuts : text.length;
  const promptOverloadRisk: RiskLevel = charsPerCut > 300 ? "high" : charsPerCut > 150 ? "medium" : "low";

  const abstractSignals = (text.match(/개념|느낌|분위기|추상|비유|concept|feeling|abstract|metaphor/gi) || []).length;
  const visualAmbiguityRisk: RiskLevel = abstractSignals > 4 ? "high" : abstractSignals > 2 ? "medium" : "low";

  return { continuityRisk, subjectCountRisk, sceneSwitchRisk, motionComplexityRisk, promptOverloadRisk, visualAmbiguityRisk, mitigationNotes: notes.slice(0, 3) };
}

// ═══════════════════════════════════════════════════════════════════
// Visual Strategy Lite
// ═══════════════════════════════════════════════════════════════════

const REALISM_MAP: Record<string, number> = {
  "live-action": 90, "cinematic": 85, "photorealistic": 95, "cinematic-realism": 90,
  "docu-handheld": 85, "commercial-ad": 80, "vintage-film": 75, "vhs-retro": 50,
  "tv-anime": 20, "anime-movie": 25, "ghibli": 30, "theatrical-anime": 25,
  "disney-3d": 35, "pixar": 35, "pixar-style": 35, "dreamworks-style": 35,
  "stop-motion": 40, "claymation": 35, "miniature-diorama": 40,
  "pixel-art": 10, "16bit-jrpg": 10, "8bit-arcade": 5,
  "rotoscoping": 55, "docu-illustrated": 70, "live-paint-overlay": 50,
  "mixed-media-collage": 30, "2d-3d-hybrid": 45, "surreal-composite": 25,
  "ink-wash": 15, "east-asian-painting": 15, "watercolor": 20, "oil-painting": 25,
  "painted-2d": 20, "watercolor-animation": 20,
};

function analyzeVisualStrategy(text: string, totalSec: number, cuts: number, animMode?: string, dirStyle?: string): VisualStrategyLite {
  if (!text || text.length < 10) return SAFE_VISUAL;

  let realism = 60;
  if (animMode) {
    const key = animMode.toLowerCase();
    for (const [k, v] of Object.entries(REALISM_MAP)) {
      if (key.includes(k) || k.includes(key)) { realism = v; break; }
    }
  }
  if (dirStyle && realism === 60) {
    if (/realistic|photorealistic|live.action/i.test(dirStyle)) realism = 85;
    else if (/anime|cartoon|stylized/i.test(dirStyle)) realism = 25;
  }

  const sents = text.split(/[.!?。\n]+/).filter(s => s.trim().length > 3);
  const spc = cuts > 0 ? sents.length / cuts : sents.length;
  const visualDensity: DensityLevel = spc > 4 ? "dense" : spc > 2 ? "moderate" : "sparse";

  const actionCount = (text.match(/달리|뛰|폭발|추격|싸우|run|chase|explode|fight|fast/gi) || []).length;
  const calmCount = (text.match(/천천히|고요|평화|정적|slowly|quietly|peaceful|static/gi) || []).length;
  const secPerCut = cuts > 0 ? totalSec / cuts : totalSec;
  const cameraEnergy: EnergyLevel = (actionCount > calmCount * 2 || secPerCut < 5) ? "dynamic" : (calmCount > actionCount * 2 || secPerCut > 10) ? "calm" : "moderate";

  const charCount = (text.match(/인물|캐릭터|주인공|얼굴|표정|character|protagonist|face/gi) || []).length;
  const envCount = (text.match(/풍경|도시|자연|건물|하늘|바다|landscape|city|nature|building/gi) || []).length;
  const characterPriority: "high" | "medium" | "low" = charCount > envCount * 2 ? "high" : charCount > envCount ? "medium" : "low";
  const environmentPriority: "high" | "medium" | "low" = envCount > charCount * 2 ? "high" : envCount > charCount ? "medium" : "low";

  return { visualDensity, cameraEnergy, realismLevel: realism, stylizationLevel: 100 - realism, characterPriority: characterPriority === "low" && environmentPriority === "low" ? "medium" : characterPriority, environmentPriority: characterPriority === "low" && environmentPriority === "low" ? "medium" : environmentPriority };
}

// ═══════════════════════════════════════════════════════════════════
// Prompt Brief Builder
// ═══════════════════════════════════════════════════════════════════

function buildPromptBrief(intent: StoryIntentAnalysis, risk: GenerationRiskAnalysis, visual: VisualStrategyLite, contMode: boolean): PromptBrief {
  const parts: string[] = [];
  if (intent.tone !== "neutral") parts.push(intent.tone);
  if (intent.genre !== "general") parts.push(intent.genre);
  if (intent.pacing === "fast" || intent.pacing === "accelerating") parts.push("quick-paced");
  else if (intent.pacing === "slow" || intent.pacing === "decelerating") parts.push("contemplative pacing");
  if (intent.protagonistFocus === "high") parts.push("protagonist-driven");
  else if (intent.protagonistFocus === "low") parts.push("environment-driven");
  if (visual.realismLevel >= 75) parts.push("realistic");
  else if (visual.stylizationLevel >= 75) parts.push("highly stylized");
  const creativeBrief = parts.join(", ");

  const continuityHint = contMode
    ? "continuity system active — reinforce consistent subject and lighting"
    : risk.continuityRisk === "high"
      ? "high continuity risk — maintain consistent subject appearance, lighting, and color palette across all cuts"
      : risk.continuityRisk === "medium"
        ? "maintain visual consistency between adjacent cuts"
        : "";

  const discParts: string[] = [];
  if (risk.subjectCountRisk === "high") discParts.push("max 2 subjects per cut");
  if (risk.sceneSwitchRisk === "high") discParts.push("avoid abrupt location resets between cuts");
  if (visual.visualDensity === "dense") discParts.push("simplify compositions — one clear focal point per cut");
  const shotDiscipline = discParts.join("; ");

  const subjectLockHint = (visual.characterPriority === "high" || risk.continuityRisk !== "low")
    ? "lock primary subject appearance throughout all cuts" : "";
  const environmentLockHint = risk.sceneSwitchRisk === "high"
    ? "keep environment consistent within scene groups" : risk.sceneSwitchRisk === "medium"
      ? "maintain environment continuity between adjacent cuts" : "";

  const avoids: string[] = [];
  if (risk.subjectCountRisk !== "low") avoids.push("crowded compositions with more than 3 subjects");
  if (risk.motionComplexityRisk === "high") avoids.push("simultaneous complex motions in single cut");
  if (risk.visualAmbiguityRisk !== "low") avoids.push("abstract metaphorical visuals without concrete anchors");
  if (risk.promptOverloadRisk === "high") avoids.push("overloaded prompts — keep each cut focused on one action");
  if (risk.sceneSwitchRisk === "high") avoids.push("abrupt scene resets without transition cues");
  if (visual.realismLevel >= 40 && visual.realismLevel <= 60) avoids.push("ambiguous realism-stylization mix — commit to either photorealistic or stylized");

  return { creativeBrief, continuityHint, shotDiscipline, subjectLockHint, environmentLockHint, avoidList: avoids.slice(0, 5) };
}

// ═══════════════════════════════════════════════════════════════════
// Serializer
// ═══════════════════════════════════════════════════════════════════

export function serializePromptBrief(brief: PromptBrief): string {
  if (!brief.creativeBrief && !brief.continuityHint && !brief.shotDiscipline && brief.avoidList.length === 0) return "";

  const lines: string[] = ["## DEEP ANALYSIS BRIEF (이 분석 결과를 컷 설계에 반영하라)"];
  if (brief.creativeBrief) lines.push(`Direction: ${brief.creativeBrief}`);
  if (brief.continuityHint) lines.push(`Continuity: ${brief.continuityHint}`);
  if (brief.shotDiscipline) lines.push(`Discipline: ${brief.shotDiscipline}`);
  if (brief.subjectLockHint) lines.push(`Subject: ${brief.subjectLockHint}`);
  if (brief.environmentLockHint) lines.push(`Environment: ${brief.environmentLockHint}`);
  if (brief.avoidList.length > 0) lines.push(`Avoid: ${brief.avoidList.join("; ")}`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════

export function runDeepAnalysis(opts: {
  storyText: string;
  totalDurationSec: number;
  cutCount: number;
  animationMode?: string;
  directorStyle?: string;
  continuityMode?: boolean;
  characterCount?: number;
}): DeepAnalysisResult {
  const t0 = Date.now();
  const warnings: string[] = [];

  let intent = SAFE_INTENT;
  try { intent = analyzeStoryIntent(opts.storyText, opts.totalDurationSec, opts.cutCount); }
  catch (e) { warnings.push(`story-intent: ${e instanceof Error ? e.message : "unknown"}`); }

  let risk = SAFE_RISK;
  try { risk = analyzeGenerationRisk(opts.storyText, opts.totalDurationSec, opts.cutCount, opts.characterCount ?? 1, opts.continuityMode ?? false); }
  catch (e) { warnings.push(`generation-risk: ${e instanceof Error ? e.message : "unknown"}`); }

  let visual = SAFE_VISUAL;
  try { visual = analyzeVisualStrategy(opts.storyText, opts.totalDurationSec, opts.cutCount, opts.animationMode, opts.directorStyle); }
  catch (e) { warnings.push(`visual-strategy: ${e instanceof Error ? e.message : "unknown"}`); }

  let brief = SAFE_BRIEF;
  try { brief = buildPromptBrief(intent, risk, visual, opts.continuityMode ?? false); }
  catch (e) { warnings.push(`prompt-brief: ${e instanceof Error ? e.message : "unknown"}`); }

  return { storyIntent: intent, generationRisk: risk, visualStrategy: visual, promptBrief: brief, analysisMs: Date.now() - t0, warnings };
}
