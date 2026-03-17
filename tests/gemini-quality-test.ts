/**
 * 실제 Gemini API 출력 품질 검증 테스트
 * - 5가지 입력 유형별 Step 1 (outline) 호출
 * - narrativeFunction 품질 검증
 * - 서사 단위 분할 vs 표면 키워드 분할 평가
 * - 컷 수 규칙 실제 적용 검증
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.argv[2] || "";
const MODEL = "gemini-3.1-pro-preview";

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY가 필요합니다. 환경변수 또는 인자로 전달해주세요.");
  process.exit(1);
}

// ── 테스트 입력 데이터 ──────────────────────────────────────

const TEST_INPUTS: Record<string, { text: string; type: string }> = {
  "설명형": {
    text: "한국의 자영업 생존율이 지속적으로 하락하고 있다. 2010년 이후 소상공인 폐업률은 매년 증가했고, 특히 코로나 이후 급격히 악화됐다. 원인은 복합적이다. 임대료 상승, 인건비 부담, 대기업 프랜차이즈와의 경쟁, 그리고 온라인 쇼핑으로의 소비 이동이 겹쳤다. 그 결과 골목상권이 무너지고, 지역 경제 생태계가 붕괴되고 있다. 하지만 일부 지역에서는 새로운 시도가 나타나고 있다. 로컬 브랜딩과 커뮤니티 기반 상권 재생이 그것이다.",
    type: "논지형"
  },
  "역사형": {
    text: "1997년 IMF 외환위기는 한국 경제의 구조를 근본적으로 바꿨다. 위기 이전에는 대기업 중심의 차입 경영이 당연시됐지만, 위기 이후 구조조정과 해고의 파도가 밀려왔다. 수백만 명이 일자리를 잃었고, 평생고용이라는 사회적 약속이 깨졌다. 그 대신 비정규직, 파견직이 급증했다. 결과적으로 한국 사회는 개인의 생존 능력을 최우선으로 여기는 방향으로 전환됐다.",
    type: "역사/인과형"
  },
  "사건형": {
    text: "새벽 3시, 공장 2층에서 화재가 발생했다. 경보가 울렸지만 야간 근무자 대부분은 귀마개를 하고 있었다. 불은 순식간에 원자재 창고로 번졌다. 소방대가 도착했을 때 건물 전체가 연기에 휩싸여 있었다. 구조대원들이 진입했고, 갇혀 있던 12명을 구출했다. 하지만 3명은 연기를 흡입한 상태였다. 사고 원인은 노후 전기 배선이었다.",
    type: "사건/액션형"
  },
  "감정형": {
    text: "아버지가 돌아가신 뒤, 나는 아버지의 서재에서 오래된 수첩을 발견했다. 거기에는 내가 모르던 아버지의 이야기가 있었다. 젊은 시절의 꿈, 포기했던 것들, 그리고 나에 대한 걱정과 사랑이 빼곡히 적혀 있었다. 나는 그제야 아버지가 왜 그렇게 말이 없었는지 이해했다. 말로 하지 못한 것들을 글로 남겨두신 거였다.",
    type: "감정/회상형"
  },
  "정보형": {
    text: "비타민 D는 햇빛을 통해 체내에서 합성되는 유일한 비타민이다. 부족하면 뼈 건강이 나빠지고, 면역력이 떨어지며, 우울감이 증가할 수 있다. 하루 권장량은 성인 기준 600~800IU이며, 겨울철이나 실내 생활이 많은 경우 보충제가 필요할 수 있다. 연어, 달걀, 버섯 등에도 포함되어 있다. 다만 과다 섭취 시 신장 결석 위험이 있으므로 적정량을 지키는 것이 중요하다.",
    type: "정보 전달형"
  },
};

// ── Step 1 프롬프트 생성 (generate-cuts.ts 로직 복제) ──────

function buildStep1Prompt(storyText: string, cutCount: number, secPerCut: number): string {
  const shotGuide = cutCount <= 5
    ? "SCENE1=WS(establishing) → SCENE2=MS(approach) → SCENE3=CU(focus) → SCENE4=OTS(reaction) → SCENE5=MCU(close)"
    : "SCENE1=WS(establishing) → SCENE2=MS(approach) → SCENE3=CU(focus) → SCENE4=OTS(reaction) → SCENE5=MCU(close) → SCENE6=ECU(detail) → SCENE7=LS(contrast) → SCENE8=CU(final)";

  return `당신은 봉준호 감독 스타일로 장면을 구조화하는 시나리오 분석가입니다.
콘텐츠: 역사/대체역사 쇼츠 내레이션 시각화. 강사/해설자 캐릭터 생성 금지. 역사적 인물/역할 기반 캐릭터만.
감독 핵심: 사회 구조적 모순을 개인의 일상에서 포착. 유머와 공포가 공존하는 톤.
조건: ${secPerCut}초/시퀀스, 총 ${cutCount}시퀀스. 각 시퀀스는 Kling 1회 생성 단위(8–15초). 시퀀스 내부 멀티샷은 별도 처리.

## ⚠️ 최우선 원칙: 서사 기능 우선 (Narrative Function First)
장면 설계 순서: 의미 분석 → 장면 기능 결정 → 시각화
절대로 "명사/배경/소품 키워드"에서 시작하지 마라. "이 텍스트가 무슨 이야기를 하는가"에서 시작하라.

### 1단계: 입력 텍스트의 서사 구조 파악
먼저 이야기를 읽고 아래를 판별하라:
- 이 텍스트의 유형: 사건 서사 / 설명·논지 / 역사·인과 / 감정·회상 / 정보 전달 / 추상 에세이
- 핵심 주장 또는 핵심 변화가 무엇인가
- 인과 관계: 무엇 때문에 무엇이 일어나는가
- 전환점: 어디서 상황/관점/감정이 바뀌는가

### 2단계: 각 시퀀스의 서사 기능 결정
각 시퀀스가 전체 이야기에서 맡는 기능을 먼저 결정하라:
- 배경 설정 / 문제 제기 / 원인 제시 / 변화 발생 / 갈등/긴장 / 결과/귀결 / 반전 / 결론/의미
시퀀스는 이 서사 기능 단위로 분할하라. 사물/장소 단위로 분할하지 마라.

### 3단계: 서사 기능을 시각적으로 표현
서사 기능이 결정된 후에 시각화하라:
- "문제 제기" → 문제의 결과가 보이는 구체적 장면
- "원인 제시" → 원인이 작동하는 장면
- "변화 발생" → 이전과 이후의 대비가 보이는 장면
- "결과/귀결" → 결과의 증거가 보이는 장면
상징/분위기 샷은 서사 기능을 보조할 때만 사용. 서사를 대체하지 마라.

## 시나리오
${storyText}

## 출력 JSON 스키마

characterSeeds (최대 3명):
- id: "char-1" 등
- label: 한국어 역할명
- appearance: 영어 ≤40 words
- appearanceKo: ≤25자

outlines (정확히 ${cutCount}개 — 각 항목은 ${secPerCut}초짜리 시퀀스):

각 씬 설계 시 반드시 아래를 먼저 정의하세요:
1. narrativeFunction: 이 시퀀스가 전체 이야기에서 맡는 역할 (영어 ≤8 words)
2. locationCue: 서사 기능을 뒷받침하는 장소 단서 (영어 ≤8 words)
3. situationCue: 서사 기능을 뒷받침하는 상황 증거 (영어 ≤8 words)
4. emotionalAnchor: 감정이 집약되는 시각 포인트 (영어 ≤8 words)

- cutNumber: 순번
- sceneKo: ≤30자
- narrativeFunction: 영어 ≤8 words
- emotion: 영어 키워드
- emotionalDelta: "이전→현재"
- purpose: establish | develop | climax | resolve
- shotType: ${shotGuide}
- cameraMovement: ≤10 words 영어
- subjectAction: 영어 ≤15 words
- transitionHint: ≤10자
- shotCategory: "character-driven" | "environment" | "object-detail" | "map-graphic" | "transition-atmosphere"
- characterRole: "protagonist" | "background" | "silhouette" | "partial" | "absent"
- locationCue: 영어 ≤8 words
- situationCue: 영어 ≤8 words
- emotionalAnchor: 영어 ≤8 words

## ⚠️ 시퀀스 밀도 규칙
- 총 ${secPerCut * cutCount}초 기준: 반드시 ${cutCount}개의 개별 시퀀스(outlines)를 작성하라

JSON만 출력:
{"characterSeeds":[...],"outlines":[...]}`;
}

// ── Gemini API 호출 ──────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 8192, responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── 품질 평가 ──────────────────────────────────────

interface QualityScore {
  cutCount: number;
  narrativeFunctionQuality: "good" | "generic" | "missing";
  narrativeFunctions: string[];
  hasNarrativeFlow: boolean;    // 원인→변화→결과 흐름
  hasSymbolOveruse: boolean;    // 상징컷이 본체 대체
  hasSurfaceKeywords: boolean;  // 표면 키워드 분할
  directorOverride: boolean;    // 감독 페르소나가 의미 덮어씀
  subjectActions: string[];
  issues: string[];
}

function evaluateQuality(outlines: any[], inputType: string): QualityScore {
  const score: QualityScore = {
    cutCount: outlines.length,
    narrativeFunctionQuality: "missing",
    narrativeFunctions: [],
    hasNarrativeFlow: false,
    hasSymbolOveruse: false,
    hasSurfaceKeywords: false,
    directorOverride: false,
    subjectActions: [],
    issues: [],
  };

  // narrativeFunction 품질
  const nfs = outlines.map(o => o.narrativeFunction || "").filter(Boolean);
  score.narrativeFunctions = nfs;

  if (nfs.length === 0) {
    score.narrativeFunctionQuality = "missing";
    score.issues.push("narrativeFunction 없음");
  } else {
    const uniqueNfs = new Set(nfs);
    if (uniqueNfs.size >= Math.min(3, nfs.length)) {
      score.narrativeFunctionQuality = "good";
    } else {
      score.narrativeFunctionQuality = "generic";
      score.issues.push(`narrativeFunction 다양성 부족 (${uniqueNfs.size}/${nfs.length} unique)`);
    }
  }

  // 서사 흐름 검증 (establish → develop/cause → change/result)
  const purposes = outlines.map(o => o.purpose || "");
  const hasEstablish = purposes.some(p => p === "establish");
  const hasDevelop = purposes.some(p => p === "develop" || p === "climax");
  const hasResolve = purposes.some(p => p === "resolve");
  score.hasNarrativeFlow = hasEstablish && hasDevelop && hasResolve;
  if (!score.hasNarrativeFlow) {
    score.issues.push(`서사 흐름 불완전: establish=${hasEstablish}, develop/climax=${hasDevelop}, resolve=${hasResolve}`);
  }

  // subjectAction 품질
  score.subjectActions = outlines.map(o => o.subjectAction || "");
  const genericActions = score.subjectActions.filter(a =>
    /^(stands|watches|looks|feels|sits|walks)(\s|$)/i.test(a)
  );
  if (genericActions.length > 1) {
    score.issues.push(`일반적 행동 ${genericActions.length}개: ${genericActions.join(", ")}`);
  }

  // 상징 과잉 체크
  const categories = outlines.map(o => o.shotCategory || "");
  const atmosphereCount = categories.filter(c => c === "transition-atmosphere" || c === "environment").length;
  if (atmosphereCount > Math.ceil(outlines.length * 0.6)) {
    score.hasSymbolOveruse = true;
    score.issues.push(`상징/분위기 샷 과잉: ${atmosphereCount}/${outlines.length}`);
  }

  // 표면 키워드 분할 체크 (locationCue가 다양하지만 narrativeFunction이 비슷한 경우)
  const locations = new Set(outlines.map(o => o.locationCue || ""));
  const nfSet = new Set(nfs);
  if (locations.size > nfSet.size * 1.5 && nfSet.size < 3) {
    score.hasSurfaceKeywords = true;
    score.issues.push("장소 다양하나 서사 기능 단조 → 표면 키워드 분할 의심");
  }

  return score;
}

// ── 메인 실행 ──────────────────────────────────────

async function main() {
  const CUT_COUNT = 3;
  const SEC_PER_CUT = 5;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  실제 Gemini API 출력 품질 검증 (Step 1 Outlines)");
  console.log(`  모델: ${MODEL}, 컷: ${CUT_COUNT}개 × ${SEC_PER_CUT}초`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results: Record<string, { outlines: any[]; quality: QualityScore; raw: any }> = {};

  for (const [label, input] of Object.entries(TEST_INPUTS)) {
    console.log(`\n────── [${label}] (${input.type}) ──────`);
    console.log(`입력: ${input.text.slice(0, 60)}...`);

    try {
      const prompt = buildStep1Prompt(input.text, CUT_COUNT, SEC_PER_CUT);
      const rawText = await callGemini(prompt);
      const parsed = JSON.parse(rawText);
      const outlines = parsed.outlines || [];
      const quality = evaluateQuality(outlines, input.type);

      results[label] = { outlines, quality, raw: parsed };

      // 결과 출력
      console.log(`\n  컷 수: ${quality.cutCount} (요청: ${CUT_COUNT})`);
      console.log(`  캐릭터: ${(parsed.characterSeeds || []).map((c: any) => c.label).join(", ") || "없음"}`);

      console.log(`\n  ┌─ 컷별 분석 ─────────────────────────────────`);
      for (const o of outlines) {
        console.log(`  │ CUT ${o.cutNumber}: ${o.sceneKo}`);
        console.log(`  │   narrativeFunction: "${o.narrativeFunction}"`);
        console.log(`  │   subjectAction: "${o.subjectAction}"`);
        console.log(`  │   purpose: ${o.purpose} | shot: ${o.shotType} | category: ${o.shotCategory}`);
        console.log(`  │   locationCue: "${o.locationCue}" | situationCue: "${o.situationCue}"`);
        console.log(`  │   emotionalAnchor: "${o.emotionalAnchor}"`);
        console.log(`  │`);
      }
      console.log(`  └─────────────────────────────────────────────`);

      // 품질 평가 요약
      console.log(`\n  📊 품질 평가:`);
      console.log(`    narrativeFunction: ${quality.narrativeFunctionQuality}`);
      console.log(`    서사 흐름 (establish→develop→resolve): ${quality.hasNarrativeFlow ? "✓" : "✗"}`);
      console.log(`    상징 과잉: ${quality.hasSymbolOveruse ? "⚠ YES" : "✓ NO"}`);
      console.log(`    표면 키워드 분할: ${quality.hasSurfaceKeywords ? "⚠ YES" : "✓ NO"}`);
      if (quality.issues.length > 0) {
        console.log(`    이슈: ${quality.issues.join(" | ")}`);
      }

    } catch (err: any) {
      console.error(`  ❌ 실패: ${err.message}`);
    }
  }

  // ── 종합 요약 ──
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  종합 품질 요약");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const entries = Object.entries(results);
  let totalIssues = 0;

  console.log("유형           | 컷수 | NF품질  | 서사흐름 | 상징과잉 | 표면분할 | 이슈수");
  console.log("─────────────┼──────┼─────────┼─────────┼─────────┼─────────┼──────");
  for (const [label, r] of entries) {
    const q = r.quality;
    totalIssues += q.issues.length;
    console.log(
      `${label.padEnd(13)}│ ${String(q.cutCount).padEnd(4)} │ ${q.narrativeFunctionQuality.padEnd(7)} │ ${q.hasNarrativeFlow ? "  ✓  " : "  ✗  "}   │ ${q.hasSymbolOveruse ? "  ⚠  " : "  ✓  "}   │ ${q.hasSurfaceKeywords ? "  ⚠  " : "  ✓  "}   │ ${q.issues.length}`
    );
  }

  console.log(`\n총 이슈: ${totalIssues}개`);

  // 모든 narrativeFunction 모아보기
  console.log("\n── 전체 narrativeFunction 목록 ──");
  for (const [label, r] of entries) {
    console.log(`  [${label}]: ${r.quality.narrativeFunctions.join(" → ")}`);
  }

  // 모든 subjectAction 모아보기
  console.log("\n── 전체 subjectAction 목록 ──");
  for (const [label, r] of entries) {
    console.log(`  [${label}]: ${r.quality.subjectActions.join(" | ")}`);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
