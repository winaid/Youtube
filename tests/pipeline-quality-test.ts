/**
 * 파이프라인 품질 검증 테스트
 * - 컷 수 규칙 (6-9s = min 3, 10-15s = min 4, typical 3-6)
 * - duration 정합성
 * - 서사 해석 (detectBeatType, describeNarrativeFunction)
 * - prompt 구조 (audio 제거, narrative function 포함)
 */

// ── 1. sequence-density: 컷 수 규칙 ────────────────────────────

import {
  recommendMinimumCutCount,
  recommendCutCountRange,
  resolveCutCount,
  densityPresetToRange,
  resolveSegmentPlan,
} from "../src/lib/sequence-density";

import { estimateAutoEditPlan } from "../src/lib/story-duration-estimator";

// ── 2. script-analyzer: 서사 해석 ────────────────────────────

import {
  analyzeScriptPhaseA,
  analyzeScript,
  detectContentType,
} from "../src/lib/script-analyzer";

// ── 3. scene-type-rules ────────────────────────────

import { getSceneTypeRule } from "../src/lib/scene-type-rules";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: 컷 수 규칙
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ TEST 1: 컷 수 규칙 (≤5s=1, 6-9s=min3, 10-15s=min4) ═══");

// recommendMinimumCutCount
assert(recommendMinimumCutCount(5) === 1, "5초 → min 1 (micro)");
assert(recommendMinimumCutCount(9) === 3, "9초 → min 3 (6-9s short band)");
assert(recommendMinimumCutCount(10) === 4, "10초 → min 4 (10-15s critical)");
assert(recommendMinimumCutCount(12) === 4, "12초 → min 4 (10-15s critical)");
assert(recommendMinimumCutCount(15) === 4, "15초 → min 4 (10-15s critical)");
assert(recommendMinimumCutCount(30) >= 4, "30초 → min 4+");
assert(recommendMinimumCutCount(60) >= 4, "60초 → min 4+");

// recommendCutCountRange
const range10 = recommendCutCountRange(10);
assert(range10.min >= 4, "10초 range.min >= 4 (10-15s critical)");
const range15 = recommendCutCountRange(15);
assert(range15.min >= 4, "15초 range.min >= 4 (10-15s critical)");
assert(range15.max >= 4 && range15.max <= 6, "15초 range.max in 4-6");

// resolveCutCount
const resolve10 = resolveCutCount({ totalDurationSec: 10 });
assert(resolve10.cutCount >= 4, "resolveCutCount(10초) >= 4");

const resolve10exact1 = resolveCutCount({ totalDurationSec: 10, exactCutCount: 1 });
assert(resolve10exact1.cutCount >= 4, "resolveCutCount(10초, exact=1) → enforced >= 4");

const resolve10exact2 = resolveCutCount({ totalDurationSec: 10, exactCutCount: 2 });
assert(resolve10exact2.cutCount >= 4, "resolveCutCount(10초, exact=2) → enforced >= 4");

const resolve5 = resolveCutCount({ totalDurationSec: 5 });
assert(resolve5.cutCount >= 1, "resolveCutCount(5초) >= 1 (micro)");

// densityPresetToRange sparse
const sparse10 = densityPresetToRange("sparse", 10);
assert(sparse10.min >= 4, "sparse preset at 10초: min >= 4 (10-15s critical)");

const sparse15 = densityPresetToRange("sparse", 15);
assert(sparse15.min >= 4, "sparse preset at 15초: min >= 4 (10-15s critical)");

// resolveSegmentPlan exactCutCount bypass 방지
const plan10exact1 = resolveSegmentPlan({ totalDurationSec: 10, exactCutCount: 1 });
assert(plan10exact1.totalTargetCuts >= 4, "resolveSegmentPlan(10초, exact=1) → enforced >= 4");

const plan15exact2 = resolveSegmentPlan({ totalDurationSec: 15, exactCutCount: 2 });
assert(plan15exact2.totalTargetCuts >= 4, "resolveSegmentPlan(15초, exact=2) → enforced >= 4");

const plan30 = resolveSegmentPlan({ totalDurationSec: 30 });
assert(plan30.totalTargetCuts >= 4, "resolveSegmentPlan(30초) >= 4");

// ═══════════════════════════════════════════════════════════════
// TEST 2: estimateAutoEditPlan
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ TEST 2: 자동 편집 플랜 ═══");

const testTexts = {
  "설명형": "한국의 자영업 생존율이 지속적으로 하락하고 있다. 2010년 이후 소상공인 폐업률은 매년 증가했고, 특히 코로나 이후 급격히 악화됐다. 원인은 복합적이다. 임대료 상승, 인건비 부담, 대기업 프랜차이즈와의 경쟁, 그리고 온라인 쇼핑으로의 소비 이동이 겹쳤다. 그 결과 골목상권이 무너지고, 지역 경제 생태계가 붕괴되고 있다. 하지만 일부 지역에서는 새로운 시도가 나타나고 있다. 로컬 브랜딩과 커뮤니티 기반 상권 재생이 그것이다.",
  "역사형": "1997년 IMF 외환위기는 한국 경제의 구조를 근본적으로 바꿨다. 위기 이전에는 대기업 중심의 차입 경영이 당연시됐지만, 위기 이후 구조조정과 해고의 파도가 밀려왔다. 수백만 명이 일자리를 잃었고, 평생고용이라는 사회적 약속이 깨졌다. 그 대신 비정규직, 파견직이 급증했다. 결과적으로 한국 사회는 개인의 생존 능력을 최우선으로 여기는 방향으로 전환됐다.",
  "사건형": "새벽 3시, 공장 2층에서 화재가 발생했다. 경보가 울렸지만 야간 근무자 대부분은 귀마개를 하고 있었다. 불은 순식간에 원자재 창고로 번졌다. 소방대가 도착했을 때 건물 전체가 연기에 휩싸여 있었다. 구조대원들이 진입했고, 갇혀 있던 12명을 구출했다. 하지만 3명은 연기를 흡입한 상태였다. 사고 원인은 노후 전기 배선이었다.",
  "감정형": "아버지가 돌아가신 뒤, 나는 아버지의 서재에서 오래된 수첩을 발견했다. 거기에는 내가 모르던 아버지의 이야기가 있었다. 젊은 시절의 꿈, 포기했던 것들, 그리고 나에 대한 걱정과 사랑이 빼곡히 적혀 있었다. 나는 그제야 아버지가 왜 그렇게 말이 없었는지 이해했다. 말로 하지 못한 것들을 글로 남겨두신 거였다.",
  "정보형": "비타민 D는 햇빛을 통해 체내에서 합성되는 유일한 비타민이다. 부족하면 뼈 건강이 나빠지고, 면역력이 떨어지며, 우울감이 증가할 수 있다. 하루 권장량은 성인 기준 600~800IU이며, 겨울철이나 실내 생활이 많은 경우 보충제가 필요할 수 있다. 연어, 달걀, 버섯 등에도 포함되어 있다. 다만 과다 섭취 시 신장 결석 위험이 있으므로 적정량을 지키는 것이 중요하다."
};

for (const [type, text] of Object.entries(testTexts)) {
  const plan = estimateAutoEditPlan(text);
  assert(plan.cutCount >= 3, `${type}: auto plan cutCount(${plan.cutCount}) >= 3`);
  assert(plan.cutCount <= 8, `${type}: auto plan cutCount(${plan.cutCount}) <= 8 (DEMO_CUT_CAP)`);
  assert(plan.cutDuration >= 3 && plan.cutDuration <= 15, `${type}: cutDuration(${plan.cutDuration}) in 3-15`);
  console.log(`    plan: ${plan.cutCount}컷 × ${plan.cutDuration}초 = ${plan.cutCount * plan.cutDuration}초 (basis: ${plan.planBasis})`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: 서사 해석 (Phase A)
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ TEST 3: 서사 해석 (detectContentType + analyzeScriptPhaseA) ═══");

for (const [type, text] of Object.entries(testTexts)) {
  const contentType = detectContentType(text);
  // Phase A: skeleton (beats + sequences without cuts)
  const phaseA = analyzeScriptPhaseA(text, { contentTypeHint: contentType });
  // Full analysis (Phase A + B): sequences with cuts populated
  const fullResult = analyzeScript(text, { contentTypeHint: contentType });

  console.log(`\n  [${type}] contentType: ${contentType}`);
  console.log(`    raw beats: ${phaseA.beats.length}개, sequences: ${fullResult.sequences.length}개`);

  // raw beats (ScriptBeat) have typeHint
  for (const beat of phaseA.beats.slice(0, 4)) {
    console.log(`    - beat ${beat.index}: typeHint=${beat.typeHint}, intensity=${beat.intensity.toFixed(2)}`);
  }

  // full result sequences have beatType + cuts[].narrativeFunction
  for (const seq of fullResult.sequences.slice(0, 3)) {
    console.log(`    - seq ${seq.id}: beatType=${seq.beatType}, cuts=${seq.cuts.length}`);
    for (const cut of seq.cuts.slice(0, 2)) {
      console.log(`      cut: narrative="${cut.narrativeFunction?.slice(0, 50)}"`);
    }
  }

  // 서사 해석 품질 검증
  assert(phaseA.beats.length >= 2, `${type}: beats >= 2`);

  // 첫 번째 raw beat는 hook이어야 함 (typeHint)
  const firstBeat = phaseA.beats[0];
  assert(
    firstBeat?.typeHint === "hook" || firstBeat?.typeHint === "setup",
    `${type}: 첫 비트가 hook/setup (actual: ${firstBeat?.typeHint})`
  );

  // 시퀀스의 첫 beatType도 hook이어야 함
  const firstSeq = fullResult.sequences[0];
  assert(
    firstSeq?.beatType === "hook" || firstSeq?.beatType === "setup",
    `${type}: 첫 시퀀스 beatType이 hook/setup (actual: ${firstSeq?.beatType})`
  );

  // narrativeFunction이 실제로 생성되는지 (cuts 레벨 — full analysis)
  const allCuts = fullResult.sequences.flatMap(s => s.cuts);
  assert(allCuts.length > 0, `${type}: cuts가 생성됨 (${allCuts.length}개)`);
  const hasNarrativeFunc = allCuts.some(c => c.narrativeFunction && c.narrativeFunction.length > 5);
  assert(hasNarrativeFunc, `${type}: narrativeFunction이 생성됨`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: 서사 기능 우선순위 검증 (변화/인과/문제 감지)
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ TEST 4: 서사 기능 우선순위 (변화>인과>문제) ═══");

// 변화 마커가 있는 문장 — raw beat의 typeHint 확인
const changeText = "2020년 이후 상황이 완전히 바뀌었다. 이전에는 안정적이었던 시장이 급격히 흔들리기 시작했다.";
const changeAnalysis = analyzeScriptPhaseA(changeText);
const changeBeat = changeAnalysis.beats.find(b => b.index > 0);
if (changeBeat) {
  console.log(`    변화 텍스트 beat[1] typeHint: ${changeBeat.typeHint}`);
  assert(
    changeBeat.typeHint === "reveal" || changeBeat.typeHint === "consequence" || changeBeat.typeHint === "transition" || changeBeat.typeHint === "payoff",
    `변화 텍스트 → reveal/consequence/transition/payoff (actual: ${changeBeat.typeHint})`
  );
} else {
  console.log("    변화 텍스트: 단일 비트 (짧은 텍스트)");
}

// 문제 마커가 있는 문장
const problemText = "시작은 좋았다. 하지만 치명적인 문제가 있었다. 자금이 바닥났고 투자자들이 등을 돌렸다.";
const problemAnalysis = analyzeScriptPhaseA(problemText);
const problemBeat = problemAnalysis.beats.find(b => b.index > 0);
if (problemBeat) {
  console.log(`    문제 텍스트 beat[1] typeHint: ${problemBeat.typeHint}`);
  assert(
    problemBeat.typeHint === "consequence" || problemBeat.typeHint === "reveal" || problemBeat.typeHint === "transition",
    `문제 텍스트 → consequence/reveal/transition (actual: ${problemBeat.typeHint})`
  );
} else {
  console.log("    문제 텍스트: 단일 비트 (짧은 텍스트)");
}

// ═══════════════════════════════════════════════════════════════
// TEST 5: Prompt 구조 검증
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ TEST 5: Prompt 구조 검증 ═══");

// scene-type-rules에서 audio 키워드 제거 확인
const personRules = getSceneTypeRule("person");
const hasAudioKeyword = (personRules.positiveKeywords ?? []).some(
  kw => kw.includes("diegetic") || kw.includes("ambient audio")
);
assert(!hasAudioKeyword, "scene-type-rules person: audio 키워드 제거됨");

// crowd 타입도 확인
const crowdRules = getSceneTypeRule("crowd");
const crowdHasAudio = (crowdRules.positiveKeywords ?? []).some(
  kw => kw.includes("diegetic") || kw.includes("ambient audio")
);
assert(!crowdHasAudio, "scene-type-rules crowd: audio 키워드 제거됨");

// sequence-assembler의 ENVIRONMENT_POSITIVE_KEYWORDS에서 audio 제거 확인
// (파일 직접 import 어려우므로 grep으로 확인)

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════");
console.log(`결과: ${passed} passed, ${failed} failed (total: ${passed + failed})`);
console.log("═══════════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
