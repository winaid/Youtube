import { PromptInput, PromptOutput, Cut, DirectorPersona, CharacterSeed } from "@/types";
import { directors } from "@/data/directors";
import { getStyleById } from "@/data/style-catalog";
import { classifyCuts } from "@/lib/structure-classification";
import { densifyCuts, VEO_SEGMENT_CAP } from "@/lib/sequence-density";
import { computeAutoDuration, buildDurationSummary } from "@/lib/duration-reconciliation";
import { estimateProjectDuration, estimateAutoEditPlan } from "@/lib/story-duration-estimator";
import { distributeRhythm } from "@/lib/rhythm-distribution";
import type { PacingMode } from "@/lib/rhythm-distribution";
import { buildMultiChainPlan, SINGLE_CHAIN_MAX_SEC } from "@/lib/multi-chain-orchestrator";
import { detectFragmentedIntent, planAutoSplitShots, type AutoSplitInput } from "@/lib/shot-plan-auto-split";
import { buildFragmentedShotBlock } from "@/lib/korean-subject-defaults";

async function fetchGeminiPersona(
  director: DirectorPersona,
  storyText: string,
  animationMode: string
): Promise<string> {
  try {
    const res = await fetch("/api/generate-persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directorName: director.name,
        directorNameKo: director.nameKo,
        style: director.style,
        description: director.description,
        storyText,
        animationMode,
        signatureTechniques: director.signatureTechniques || null,
        notableWorks: director.notableWorks || [],
      }),
    });
    const data = await res.json();
    return data.persona || director.persona || "";
  } catch {
    return director.persona || "";
  }
}

async function fetchGeminiCuts(
  input: PromptInput,
  director: DirectorPersona,
  directorPersonaText: string,
  cutCount: number,
  cutDuration: number,
  projectTotalDurationSec: number,
): Promise<{ characterSeeds: CharacterSeed[]; cuts: Cut[]; usedFallback?: boolean; fallbackReason?: string; fallbackCause?: string; degraded?: boolean; degradedReason?: string; sequencePlan?: unknown; sequenceValidation?: unknown; generationMeta?: Record<string, unknown>; _latency?: unknown; _fastPathEval?: unknown }> {
  try {
    const res = await fetch("/api/generate-cuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyText: input.storyText,
        directorName: director.name,
        directorNameKo: director.nameKo,
        directorStyle: director.style,
        directorPersona: directorPersonaText,
        directorTechniques: director.signatureTechniques || null,
        animationMode: input.animationMode,
        aspectRatio: input.aspectRatio,
        region: input.region,
        cutCount,
        cutDuration,
        // ── 편집 밀도 범위 + project total 길이 ──
        // effectiveDuration은 명시값 또는 스토리 기반 추정값. undefined로 빠지지 않음.
        preferredCutCountRange: input.preferredCutCountRange ?? null,
        totalDurationSeconds: projectTotalDurationSec,
        // 페르소나 시스템
        generationPersona: input.generationPersona ?? null,
        characterPersonas: input.characterPersonas ?? [],
        // 대본 사전 분석 힌트 (분석 깊이 옵션 활성 시)
        scriptAnalysisHint: input.scriptAnalysisHint ?? null,
        // ── Continuity mode ──
        continuityMode: input.continuityMode ?? false,
        // ── 나레이션 속도 ──
        narrationSpeed: input.narrationSpeed ?? "natural",
        // ── 분절 편집 컨텍스트 ──
        fragmentedEditContext: detectFragmentedIntent(input.storyText),
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({} as Record<string, string>));
      const eb = errBody as Record<string, string>;
      const cause = eb.cause || "";
      const code = eb.code || "";
      const detail = eb.detail || eb.error || "unknown";
      const help = eb.help || "";
      if (code === "MISSING_API_KEY") {
        throw new Error(`MISSING_API_KEY: ${help || "GEMINI_API_KEY 환경변수를 설정하세요."}`);
      }
      if (code === "MODEL_NOT_FOUND") {
        throw new Error(`MODEL_NOT_FOUND: ${help || "모델이 deprecated됨. _gemini-keys.ts 확인."}`);
      }
      if (code === "INVALID_API_KEY") {
        throw new Error(`INVALID_API_KEY: ${help || "API 키가 유효하지 않습니다."}`);
      }
      // Provider 가용성 에러 → 사용자 친화적 메시지
      if (cause === "PROVIDER_UNAVAILABLE" || cause === "PROVIDER_RATE_LIMIT") {
        const retryHint = (eb as Record<string, unknown>).retryable ? " 잠시 후 다시 시도해주세요." : "";
        throw new Error(
          cause === "PROVIDER_RATE_LIMIT"
            ? `AI 서버 요청 한도 초과.${retryHint}`
            : `AI 모델 서버가 일시적으로 응답하지 않습니다.${retryHint}`,
        );
      }
      throw new Error(
        cause === "MAX_TOKENS"
          ? `토큰 한도 초과 (step ${eb.step || "?"}): ${detail}`
          : `API error: ${res.status} [${code || "UNKNOWN"}] — ${detail}`,
      );
    }

    const data = await res.json();
    const characterSeeds: CharacterSeed[] = Array.isArray(data.characterSeeds)
      ? data.characterSeeds.map((s: Partial<CharacterSeed>) => ({
          id: s.id ?? "char-unknown",
          label: s.label ?? "",
          appearance: s.appearance ?? "",
          appearanceKo: s.appearanceKo ?? "",
        }))
      : [];

    const cuts: Cut[] = Array.isArray(data.cuts) && data.cuts.length > 0
      ? data.cuts.map((cut: Partial<Cut>, i: number) => ({
          cutNumber: cut.cutNumber ?? i + 1,
          durationSec: cut.durationSec ?? cutDuration,
          sceneDescription: cut.sceneDescription ?? "",
          cameraDirection: cut.cameraDirection ?? "",
          moodLighting: cut.moodLighting ?? "",
          imagePrompt: cut.imagePrompt ?? "",
          endImagePrompt: cut.endImagePrompt ?? "",
          videoPrompt: cut.videoPrompt ?? "",
          extendPrompt: cut.extendPrompt ?? "",
          transitionHint: cut.transitionHint ?? "",
          characterConsistency: cut.characterConsistency ?? "",
          charactersInScene: Array.isArray(cut.charactersInScene) ? cut.charactersInScene : [],
          // JSON 기반 프롬프트 — API에서 온 구조화 데이터 보존
          shotCategory: cut.shotCategory,
          characterRole: cut.characterRole,
          videoPromptJson: cut.videoPromptJson,
          extendPromptJson: cut.extendPromptJson,
          // Continuity segment metadata — generate-cuts에서 생성, useVideoGeneration에서 소비
          continuitySegment: cut.continuitySegment ?? undefined,
        }))
      : [];

    if (cuts.length === 0) throw new Error("Empty cuts from API");

    // Latency breakdown 로그 (서버에서 반환)
    if (data._latency) {
      console.log("[generate-cuts] LATENCY:", data._latency);
    }
    if (data._fastPathEval) {
      console.log("[generate-cuts] FAST PATH EVAL:", data._fastPathEval);
    }

    return {
      characterSeeds,
      cuts,
      degraded: data.degraded === true,
      degradedReason: typeof data.reason === "string" ? data.reason : undefined,
      sequencePlan: data.sequencePlan ?? undefined,
      sequenceValidation: data.sequenceValidation ?? undefined,
      generationMeta: data.generationMeta ?? undefined,
      _latency: data._latency ?? undefined,
      _fastPathEval: data._fastPathEval ?? undefined,
    };
  } catch (error) {
    const errStr = String(error);
    console.error("Cuts API error, using fallback:", errStr);

    // 에러 원인 분류 — 정확한 사용자 안내를 위해
    let fallbackCause: string;
    if (errStr.includes("토큰 한도") || errStr.includes("MAX_TOKENS") || errStr.includes("truncat")) {
      fallbackCause = "MAX_TOKENS";
    } else if (errStr.includes("MISSING_API_KEY")) {
      fallbackCause = "MISSING_API_KEY";
    } else if (errStr.includes("INVALID_API_KEY")) {
      fallbackCause = "INVALID_API_KEY";
    } else if (errStr.includes("MODEL_NOT_FOUND") || errStr.includes("deprecated")) {
      fallbackCause = "MODEL_NOT_FOUND";
    } else if (errStr.includes("429") || errStr.includes("quota") || errStr.includes("QUOTA")) {
      fallbackCause = "QUOTA_EXCEEDED";
    } else if (errStr.includes("fetch") || errStr.includes("network") || errStr.includes("ECONNREFUSED")) {
      fallbackCause = "NETWORK_ERROR";
    } else {
      fallbackCause = "UNKNOWN";
    }

    const fallback = generateFallbackCuts(input, director, cutCount, cutDuration);
    return { ...fallback, usedFallback: true, fallbackReason: errStr, fallbackCause };
  }
}

/**
 * 멀티 체인 분할 호출: 체인별로 generate-cuts를 순차 호출하고 결과를 합침.
 * Gemini 토큰 한도 때문에 한 번에 75+컷을 생성할 수 없으므로,
 * 체인 단위(~20컷)로 나눠서 호출한다.
 */
async function fetchGeminiCutsInChains(
  input: PromptInput,
  director: DirectorPersona,
  directorPersonaText: string,
  plan: { chains: Array<{ cutCount: number; targetDurationSec: number; chainIndex: number }> },
  cutDuration: number,
): Promise<Awaited<ReturnType<typeof fetchGeminiCuts>>> {
  const allCuts: Cut[] = [];
  let allCharacterSeeds: CharacterSeed[] = [];
  let globalCutOffset = 0;

  console.info(`[multi-chain] 체인별 배치 생성 시작: ${plan.chains.length}체인`);

  for (const chain of plan.chains) {
    console.info(`[multi-chain] 체인 ${chain.chainIndex + 1}/${plan.chains.length}: ${chain.cutCount}컷, ${chain.targetDurationSec}초`);

    try {
      const chainResult = await fetchGeminiCuts(
        input,
        director,
        directorPersonaText,
        chain.cutCount,
        cutDuration,
        chain.targetDurationSec,
      );

      // cutNumber를 글로벌 오프셋으로 조정
      const adjustedCuts = chainResult.cuts.map((cut, i) => ({
        ...cut,
        cutNumber: globalCutOffset + i + 1,
      }));

      allCuts.push(...adjustedCuts);
      if (chain.chainIndex === 0 && chainResult.characterSeeds.length > 0) {
        allCharacterSeeds = chainResult.characterSeeds;
      }

      globalCutOffset += chainResult.cuts.length;
    } catch (error) {
      console.error(`[multi-chain] 체인 ${chain.chainIndex + 1} 실패:`, error);
      // 실패한 체인은 fallback으로 채움
      const fallback = generateFallbackCuts(input, director, chain.cutCount, cutDuration);
      const adjustedCuts = fallback.cuts.map((cut, i) => ({
        ...cut,
        cutNumber: globalCutOffset + i + 1,
      }));
      allCuts.push(...adjustedCuts);
      globalCutOffset += fallback.cuts.length;
      if (allCharacterSeeds.length === 0) allCharacterSeeds = fallback.characterSeeds;
    }
  }

  console.info(`[multi-chain] 완료: 총 ${allCuts.length}컷 생성`);

  return {
    characterSeeds: allCharacterSeeds,
    cuts: allCuts,
  };
}

function generateFallbackCuts(
  input: PromptInput,
  director: DirectorPersona,
  cutCount: number,
  cutDuration = 6
): { characterSeeds: CharacterSeed[]; cuts: Cut[] } {
  const storyWords = input.storyText.slice(0, 30);
  const directorStyle = director.style;

  const catalogStyle = getStyleById(input.animationMode);
  const videoStyle = catalogStyle
    ? catalogStyle.positivePrompt.split(". ").slice(0, 2).join(". ")
    : "photorealistic, cinematic film grain, 4K quality";

  const characterSeeds: CharacterSeed[] = [{
    id: "char-1",
    label: "주인공",
    appearance: "A young person, black hair, average build, wearing casual modern clothing",
    appearanceKo: "검은 머리, 보통 체형, 캐주얼 현대 의상 (API 연결 후 AI가 구체적으로 생성합니다)",
  }];

  const charDesc = characterSeeds[0].appearance;

  const cuts = Array.from({ length: cutCount }, (_, i) => ({
    cutNumber: i + 1,
    durationSec: cutDuration,
    sceneDescription: `[장면 ${i + 1}] ${storyWords} 기반 장면 (API 연결 후 AI가 생성합니다)`,
    cameraDirection: "slow push-in toward subject",
    moodLighting: "golden hour warm lighting, soft shadows",
    imagePrompt: `${videoStyle}, ${directorStyle}, ${charDesc}, scene ${i + 1} start frame, highly detailed, cinematic quality`,
    endImagePrompt: `${videoStyle}, ${directorStyle}, ${charDesc}, scene ${i + 1} end frame, camera moved to final position, highly detailed, cinematic quality`,
    videoPrompt: (() => {
      // establishing→evidence→anchor 구조 (즉시 인식 가능성)
      const beat = cutDuration === 4
        ? { b1: "0s-1s", b2: "1s-3s", b3: "3s-4s" }
        : cutDuration === 6
          ? { b1: "0s-2s", b2: "2s-4s", b3: "4s-6s" }
          : cutDuration === 10
            ? { b1: "0s-3s", b2: "3s-7s", b3: "7s-10s" }
            : cutDuration === 15
              ? { b1: "0s-4s", b2: "4s-10s", b3: "10s-15s" }
              : { b1: "0s-2s", b2: "2s-5s", b3: "5s-8s" };
      return `Wide shot, eye-level, slow dolly in. ${beat.b1}: LOCATION — establishing space, identifiable location objects, ${videoStyle}. ${beat.b2}: SITUATION — visual evidence of current state, ${directorStyle} tone. ${beat.b3}: EMOTION — ${charDesc}, concrete physical action revealing feeling. Warm key light from upper left, soft diffused. ${director.name} style, cinematic. No text, no watermark`;
    })(),
    extendPrompt: i > 0
      ? (() => {
        const beat = cutDuration === 4
          ? { b1: "0s-1s", b2: "1s-3s", b3: "3s-4s" }
          : cutDuration === 6
            ? { b1: "0s-2s", b2: "2s-4s", b3: "4s-6s" }
            : cutDuration === 10
              ? { b1: "0s-3s", b2: "3s-7s", b3: "7s-10s" }
              : cutDuration === 15
                ? { b1: "0s-4s", b2: "4s-10s", b3: "10s-15s" }
                : { b1: "0s-2s", b2: "2s-5s", b3: "5s-8s" };
        return `Continue from previous scene. ${beat.b1}: LOCATION — new angle on location-defining objects, ${videoStyle}. ${beat.b2}: SITUATION — situation evidence with ${directorStyle} tone. ${beat.b3}: EMOTION — ${charDesc}, emotional anchor through physical action. Same character maintained. No text, no watermark`;
      })()
      : "",
    transitionHint: i < cutCount - 1 ? "디졸브 - 다음 장면으로 자연스럽게 전환" : "페이드 아웃 - 마무리",
    characterConsistency: `캐릭터 시드 char-1 고정: ${characterSeeds[0].appearanceKo}. 모든 장면에서 동일한 외형 유지. ${directorStyle} 톤 일관성 유지.`,
    charactersInScene: ["char-1"],
  }));

  return { characterSeeds, cuts };
}

/** shot index → role 추론 (auto-split 결과를 MultiShotPrompt로 변환 시) */
function inferRoleFromShotId(
  _shotId: string,
  totalShots: number,
): "establish" | "develop" | "peak" | "resolve" | "insert" | "transition" | undefined {
  // planShotRoles에서 이미 결정됨 — 여기선 index 기반 간단 추론
  const patterns: Record<number, Array<"establish" | "develop" | "peak" | "resolve" | "insert" | "transition">> = {
    3: ["establish", "develop", "resolve"],
    4: ["establish", "develop", "peak", "resolve"],
    5: ["establish", "transition", "develop", "peak", "resolve"],
    6: ["establish", "transition", "develop", "insert", "peak", "resolve"],
  };
  const idx = parseInt(_shotId.replace("shot_", ""), 10) - 1;
  const pattern = patterns[totalShots] ?? patterns[4]!;
  return pattern[idx % pattern.length];
}

export async function generatePrompt(
  input: PromptInput
): Promise<PromptOutput> {
  const director = input.customDirector ?? directors.find((d) => d.id === input.directorPersona);
  const directorName = director?.nameKo ?? "알 수 없는 감독";
  const directorStyle = director?.style ?? "";

  // project total duration 추정: 명시값이면 그대로, auto이면 스토리 기반 추정
  // 주의: 이 값은 project total이다. current segment cap(15초)과 혼동하지 말 것.
  const isFullAuto = input.duration === "auto" && !input.cutDuration && !input.cutCount;

  let effectiveDuration: number;
  let cutDuration: number;
  let cutCount: number;

  if (isFullAuto) {
    // ── 전체 자동: 스토리 기반 최적 편집 파라미터 일괄 추정 ──
    const plan = estimateAutoEditPlan(input.storyText);
    effectiveDuration = plan.totalSec;
    cutDuration = plan.cutDuration;
    cutCount = plan.cutCount;

    console.info("[generatePrompt] 전체 자동 모드", {
      planBasis: plan.planBasis,
      effectiveDuration,
      cutDuration,
      cutCount,
      expectedTotal: `${cutCount} × ${cutDuration} = ${cutCount * cutDuration}초`,
    });
  } else {
    // ── 일부 명시/혼합 모드 ──
    effectiveDuration =
      input.duration === "auto"
        ? estimateProjectDuration(input.storyText).estimatedTotalSec
        : input.duration;

    const autoResult = computeAutoDuration({
      cutDuration: input.cutDuration,
      totalDurationSeconds: effectiveDuration,
      cutCount: input.cutCount ?? undefined,
    });
    cutDuration = autoResult.duration;
    cutCount = input.cutCount ?? Math.max(4, Math.round(effectiveDuration / cutDuration));

    console.info("[generatePrompt] 혼합/명시 모드", {
      inputDuration: input.duration,
      inputCutDuration: input.cutDuration,
      inputCutCount: input.cutCount,
      effectiveDuration,
      autoResultBasis: autoResult.basis,
      resolvedCutDuration: cutDuration,
      resolvedCutCount: cutCount,
      expectedTotal: `${cutCount} × ${cutDuration} = ${cutCount * cutDuration}초`,
    });
  }

  const storyWords = input.storyText.slice(0, 30);

  // 1+2. 페르소나 생성과 장면 생성을 가능한 한 병렬화
  // 내장 감독(persona 있음)은 persona fetch 건너뛰고 바로 cuts 호출
  // 커스텀 감독(persona 없음)은 persona fetch와 cuts를 동시에 시작하되,
  // cuts에는 빈 persona로 요청 (서버가 directorStyle/techniques로 보완)
  const needsPersonaFetch = !!director && (!director.persona || !!input.customDirector);
  const existingPersona = director?.persona ?? "";

  let directorPersonaText: string;
  let cutsResult: Awaited<ReturnType<typeof fetchGeminiCuts>>;

  // ── 멀티 체인 분할: 141초 초과 시 체인별 배치 호출 ──
  // Gemini 토큰 한도 때문에 한 번에 75컷을 생성할 수 없음.
  // 체인별로 나눠서 호출하고 결과를 합침.
  const multiChainPlan = effectiveDuration > SINGLE_CHAIN_MAX_SEC
    ? buildMultiChainPlan(effectiveDuration)
    : null;

  if (!director) {
    directorPersonaText = "";
    cutsResult = { ...generateFallbackCuts(input, { id: "", name: "Unknown", nameKo: "알 수 없음", region: "한국", style: "", description: "", persona: "" }, cutCount, cutDuration), usedFallback: true, fallbackReason: "감독 정보 없음" };
  } else if (needsPersonaFetch) {
    directorPersonaText = await fetchGeminiPersona(director, input.storyText, input.animationMode);
    if (multiChainPlan && multiChainPlan.isMultiChain) {
      cutsResult = await fetchGeminiCutsInChains(input, director, directorPersonaText, multiChainPlan, cutDuration);
    } else {
      cutsResult = await fetchGeminiCuts(input, director, directorPersonaText, cutCount, cutDuration, effectiveDuration);
    }
  } else {
    directorPersonaText = existingPersona;
    if (multiChainPlan && multiChainPlan.isMultiChain) {
      cutsResult = await fetchGeminiCutsInChains(input, director, directorPersonaText, multiChainPlan, cutDuration);
    } else {
      cutsResult = await fetchGeminiCuts(input, director, directorPersonaText, cutCount, cutDuration, effectiveDuration);
    }
  }
  const { characterSeeds, cuts: rawCuts, usedFallback, fallbackReason, fallbackCause, degraded, degradedReason, sequencePlan, sequenceValidation, generationMeta: serverMeta } = cutsResult;

  // ── rhythm distribution: 서버 응답에 rhythmProfile이 없으면 클라이언트 측 분배 적용 ──
  const needsClientRhythm = !cutsResult.sequencePlan || usedFallback;
  let rhythmAppliedCuts = rawCuts;
  if (needsClientRhythm && rawCuts.length > 0) {
    const pacingMode: PacingMode = "balanced";
    const rhythmInputs = rawCuts.map((c, i) => ({
      cutNumber: c.cutNumber ?? i + 1,
      purpose: (c as unknown as Record<string, unknown>).purpose as string | undefined,
      shotType: (c as unknown as Record<string, unknown>).shotType as string | undefined,
      shotCategory: (c as unknown as Record<string, unknown>).shotCategory as string | undefined,
      durationSec: c.durationSec,
    }));
    const rhythmResult = distributeRhythm(rhythmInputs, pacingMode);
    rhythmAppliedCuts = rawCuts.map((c, i) => ({
      ...c,
      durationSec: rhythmResult.cuts[i]?.durationSec ?? c.durationSec,
    }));
  }

  // ── 분절 편집 강제: 분절 편집 요청이 있으면 multiShot 보강 ──
  const fragmentedCtx = detectFragmentedIntent(input.storyText);
  if (fragmentedCtx.isFragmented) {
    for (const cut of rhythmAppliedCuts) {
      const existingShots = Array.isArray(cut.multiShot) ? cut.multiShot.length : 0;
      if (existingShots < fragmentedCtx.minShotCount) {
        const splitInput: AutoSplitInput = {
          storyText: input.storyText,
          sceneDescription: cut.sceneDescription || "",
          subjectPrimary: cut.charactersInScene?.[0] || "subject",
          action: cut.videoPrompt || cut.sceneDescription || "",
          environment: (cut.sceneDescription || "").slice(0, 80) || "scene environment",
          moodLighting: cut.moodLighting || "",
          durationSec: cut.durationSec,
          camera: { framing: "MS", angle: "eye-level", motion: "steady" },
          sceneType: cut.shotCategory,
          styleSuffix: cut.videoPrompt?.includes("No text") ? "No text, no watermark" : undefined,
        };
        const autoResult = planAutoSplitShots(splitInput);
        if (autoResult.validation.passed && autoResult.shots.length >= 3) {
          cut.multiShot = autoResult.shots.map((shot, i) => ({
            index: i + 1,
            prompt: shot.action,
            duration: String(Math.round(shot.endSec - shot.startSec)),
            role: inferRoleFromShotId(shot.shotId, autoResult.shots.length),
          }));
        }
      }
    }
  }

  // density 보정 후 구조 보조 메타 자동 부여
  const cuts = classifyCuts(densifyCuts(rhythmAppliedCuts));

  const catalogStyle = getStyleById(input.animationMode);
  const videoStyle = catalogStyle
    ? catalogStyle.positivePrompt.split(". ").slice(0, 2).join(". ")
    : "photorealistic, cinematic film grain, 4K quality";

  const regionFlavor: Record<string, string> = {
    한국: "Korean aesthetic, Korean urban-rural atmosphere",
    일본: "Japanese aesthetic, traditional-modern contrast",
    중국: "Chinese cinematic grandeur, classical architecture",
    유럽: "European architecture, classical atmosphere",
    미국: "American cinematic, diverse urban landscape",
  };
  const region = regionFlavor[input.region] ?? "";

  // 캐릭터 시드 요약을 글로벌 스타일에 포함
  const charSeedSummary = characterSeeds.length > 0
    ? characterSeeds.map(s => `[${s.id}: ${s.appearance}]`).join(" ")
    : "";

  // actual cuts 기반 duration summary 생성 (source of truth)
  const isAutoMode = !input.cutDuration || input.cutDuration <= 0;
  const durationSummary = buildDurationSummary({
    cuts,
    requestedSecondsPerScene: isAutoMode ? 0 : input.cutDuration,
    durationBasis: isFullAuto ? "story_auto" : "mixed",
  });

  return {
    projectTitle: `${directorName}의 시선으로: ${storyWords}...`,
    conceptSummary: `${directorName} 감독의 연출 스타일(${directorStyle})을 적용하여, "${storyWords}..." 시나리오를 ${durationSummary.headline} 분량의 ${input.animationMode} 영상으로 구성했습니다. ${characterSeeds.length}명의 캐릭터가 시드 고정되어 전체 장면에서 동일한 외형을 유지합니다.`,
    totalCuts: cuts.length,
    globalStylePrompt: `[Global Style] ${videoStyle}, ${region}, directed by ${director?.name ?? "auteur"}, ${charSeedSummary}, consistent character design across all cuts, unified color palette, ${input.aspectRatio} aspect ratio, cinematic quality, no text overlay, no watermark`,
    directorPersonaPrompt: directorPersonaText,
    characterSeeds,
    continuityRules: [
      `캐릭터 시드 ${characterSeeds.length}명 고정: 모든 장면의 프롬프트에 캐릭터 전체 외형 묘사가 반복 삽입됨`,
      "Extend 프롬프트 사용 시 이전 장면 마지막 순간을 구체적으로 묘사하여 자연스러운 연결",
      "캐릭터 외형(의상, 헤어스타일, 체형, 피부톤)을 모든 장면에서 절대 변경 금지",
      `색감/조명은 ${directorName} 스타일의 시그니처 톤으로 통일`,
      "각 클립의 시작 프레임이 이전 클립의 끝 프레임과 매칭되도록 구성",
      "CUT 1은 Video Prompt로 생성, CUT 2부터는 이전 클립 + Extend Prompt로 연장",
    ],
    cuts,
    usedFallback,
    fallbackReason,
    fallbackCause: fallbackCause as PromptOutput["fallbackCause"],
    degraded,
    degradedReason,
    sequencePlan: sequencePlan as PromptOutput["sequencePlan"],
    sequenceValidation: sequenceValidation as PromptOutput["sequenceValidation"],
    serverGenerationMeta: serverMeta as PromptOutput["serverGenerationMeta"],
  };
}
