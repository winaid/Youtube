/**
 * 6계층 프롬프트 아키텍처 테스트
 *
 * 테스트 시나리오:
 * 1. Subject Anchor가 첫 문장에 고정되는지
 * 2. Scene Lock이 카메라 시점을 명확히 하는지
 * 3. 위험 단어가 subject 없이 단독 사용되면 제거되는지
 * 4. 장르 템플릿이 올바른 negative를 생성하는지
 * 5. 실패 패턴 라이브러리가 정확히 매칭되는지
 * 6. 드리프트 위험도 계산이 정확한지
 * 7. 자동 교정이 올바르게 작동하는지
 * 8. Continuity가 객체 기반으로 작동하는지
 * 9. 스타일이 마지막에만 약하게 적용되는지
 * 10. 장르별 프롬프트 출력 품질
 *
 * 실행: npx tsx tests/prompt-architecture.test.ts
 */

import {
  buildSubjectAnchor,
  buildSceneLock,
  buildVisualDetails,
  buildTemporalAction,
  buildContinuityLock,
  buildNegativePrompt,
  hasStrongSubjectAnchor,
  controlDangerousWords,
  collectFailureModeNegatives,
  assessAndCorrectDrift,
  assemblePromptV2,
  getGenreTemplate,
  GENRE_TEMPLATES,
  FAILURE_MODES,
} from "../src/lib/prompt-architecture";

// ── 테스트 러너 ────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: Subject Anchor 감지
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 1] Subject Anchor 강도 감지");
{
  assert(
    hasStrongSubjectAnchor("A flat antique paper map of Asia laid on a table"),
    "구체적 subject(map) → strong"
  );
  assert(
    hasStrongSubjectAnchor("A silver smartphone standing upright on a clean surface"),
    "구체적 subject(phone) → strong"
  );
  assert(
    hasStrongSubjectAnchor("A middle-aged woman sitting alone in a modern office"),
    "구체적 subject(woman + office) → strong"
  );
  assert(
    !hasStrongSubjectAnchor("Symbolic and haunting dreamlike atmosphere"),
    "추상어만 → weak"
  );
  assert(
    !hasStrongSubjectAnchor("Eerie mystical ethereal surreal cosmic"),
    "위험 단어만 → weak"
  );
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: 위험 단어 제어
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 2] 위험 단어 제어");
{
  // subject 약할 때 → 위험 단어 제거
  const { cleaned, removedWords } = controlDangerousWords(
    "The symbolic and haunting mood creates a dreamlike atmosphere",
    false
  );
  assert(removedWords.length >= 3, `위험 단어 ${removedWords.length}개 제거됨`);
  assert(!cleaned.includes("symbolic"), "symbolic 제거됨");
  assert(!cleaned.includes("haunting"), "haunting 제거됨");
  assert(!cleaned.includes("dreamlike"), "dreamlike 제거됨");

  // subject 강할 때 → 위험 단어 유지
  const { cleaned: kept } = controlDangerousWords(
    "A silver phone on a table in symbolic lighting",
    true
  );
  assert(kept.includes("symbolic"), "strong subject → symbolic 유지");
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: 장르 템플릿
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 3] 장르 템플릿 로드");
{
  const mapTemplate = getGenreTemplate("map-graphic");
  assert(mapTemplate !== undefined, "map-graphic 템플릿 존재");
  assert(mapTemplate!.commonNegatives.includes("landscape"), "map negative에 landscape 포함");
  assert(mapTemplate!.notConstraints.length > 0, "map에 'not X' 제약 존재");

  const productTemplate = getGenreTemplate("product-shot");
  assert(productTemplate !== undefined, "product-shot 템플릿 존재");
  assert(productTemplate!.commonNegatives.includes("abstract sculpture"), "product negative에 abstract sculpture 포함");

  const charTemplate = getGenreTemplate("character-driven");
  assert(charTemplate !== undefined, "character-driven 템플릿 존재");
  assert(charTemplate!.commonNegatives.includes("extra limbs"), "character negative에 extra limbs 포함");

  // 레거시 별칭
  const objectTemplate = getGenreTemplate("object-detail");
  assert(objectTemplate !== undefined, "object-detail → product-shot 매핑");

  // 없는 장르
  const unknown = getGenreTemplate("unknown-type");
  assert(unknown === undefined, "없는 장르 → undefined");

  // 모든 장르 수 확인
  assert(Object.keys(GENRE_TEMPLATES).length >= 7, `장르 템플릿 ${Object.keys(GENRE_TEMPLATES).length}개 이상`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: 실패 패턴 라이브러리
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 4] 실패 패턴 매칭");
{
  const mapNeg = collectFailureModeNegatives("A flat paper map of Asia");
  assert(mapNeg.includes("landscape"), "map → landscape negative 주입");
  assert(mapNeg.includes("nature scene"), "map → nature scene negative 주입");

  const productNeg = collectFailureModeNegatives("A silver smartphone on a studio surface");
  assert(productNeg.includes("abstract sculpture"), "product → abstract sculpture negative 주입");

  const personNeg = collectFailureModeNegatives("A woman sitting in a room");
  assert(personNeg.includes("extra limbs"), "person → extra limbs negative 주입");
  assert(personNeg.includes("surreal architecture"), "room → surreal architecture negative 주입");

  // 여러 패턴 동시 매칭
  const multiNeg = collectFailureModeNegatives("A person holding a phone in a room");
  assert(multiNeg.length > 5, `복수 패턴 매칭 → ${multiNeg.length}개 negative`);

  // 매칭 없는 경우
  const emptyNeg = collectFailureModeNegatives("xyz abc");
  assert(emptyNeg.length === 0, "패턴 미매칭 → 0개 negative");
}

// ═══════════════════════════════════════════════════════════════
// TEST 5: 드리프트 위험도 계산
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 5] 드리프트 위험도 평가");
{
  // 낮은 위험: 구체적 프롬프트
  const low = assessAndCorrectDrift(
    "A flat antique paper map of Asia laid on a wooden table. Aged parchment texture, faded ink coastlines.",
    { scenePrompt: "A flat antique paper map of Asia", shotCategory: "map-graphic", durationSec: 8, styleIntensity: 50 }
  );
  assert(low.riskLevel === "low", `구체적 프롬프트 → risk level: ${low.riskLevel}`);

  // 높은 위험: 추상적 프롬프트
  const high = assessAndCorrectDrift(
    "Symbolic and haunting dreamlike eerie atmosphere",
    { scenePrompt: "Symbolic and haunting dreamlike eerie atmosphere", durationSec: 8, styleIntensity: 50 }
  );
  assert(high.riskLevel === "high", `추상 프롬프트 → risk level: ${high.riskLevel}`);
  assert(high.correctedPrompt !== undefined, "high risk → 자동 교정 발생");
  assert(high.issues.length >= 2, `${high.issues.length}개 이상 이슈 감지`);

  // 중간 위험: 부분적으로 구체적
  const med = assessAndCorrectDrift(
    "Dark mysterious corridor with eerie lighting",
    { scenePrompt: "Dark mysterious corridor with eerie lighting", durationSec: 8, styleIntensity: 50 }
  );
  assert(med.riskLevel === "medium" || med.riskLevel === "high", `부분적 프롬프트 → risk: ${med.riskLevel}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 6: Scene Lock 빌더
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 6] Scene Lock 빌더");
{
  const mapLock = buildSceneLock({
    scenePrompt: "A flat paper map",
    shotCategory: "map-graphic",
    durationSec: 8,
    styleIntensity: 50,
  });
  assert(mapLock.includes("not a landscape"), "map scene lock에 'not a landscape' 포함");

  const productLock = buildSceneLock({
    scenePrompt: "A phone on a table",
    shotCategory: "product-shot",
    shotType: "CU",
    durationSec: 8,
    styleIntensity: 50,
  });
  assert(productLock.includes("Close-up"), "product에 Close-up framing");
  assert(productLock.includes("not"), "product scene lock에 'not' 제약 포함");
}

// ═══════════════════════════════════════════════════════════════
// TEST 7: Continuity Lock (객체 기반)
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 7] Continuity Lock — 객체 기반");
{
  const continuity = buildContinuityLock({
    primarySubject: "the antique paper map of Asia",
    surfaceMaterial: "aged yellowed parchment",
    environmentType: "tabletop view",
    lightingDirection: "cold daylight from upper right",
  });
  assert(continuity.includes("Same subject"), "continuity에 subject 유지");
  assert(continuity.includes("Same surface"), "continuity에 surface 유지");
  assert(continuity.includes("Same environment"), "continuity에 environment 유지");
  assert(!continuity.includes("mood"), "continuity에 mood 미포함 (객체 기반)");

  // 레거시 호환
  const legacy = buildContinuityLock({
    characterConsistency: "Same middle-aged woman with dark hair",
  });
  assert(legacy.includes("Same middle-aged woman"), "레거시 characterConsistency 사용");

  // 빈 continuity
  const empty = buildContinuityLock(undefined);
  assert(empty === "", "continuity 없으면 빈 문자열");
}

// ═══════════════════════════════════════════════════════════════
// TEST 8: Negative Prompt 빌더 (범용 + scene-specific)
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 8] Negative Prompt 빌더");
{
  const mapNeg = buildNegativePrompt({
    scenePrompt: "A flat paper map of Asia",
    shotCategory: "map-graphic",
    durationSec: 8,
    styleIntensity: 50,
  });
  assert(mapNeg.startsWith("Avoid:"), "Avoid: 접두사");
  assert(mapNeg.includes("landscape"), "map negative에 landscape");
  assert(mapNeg.includes("text overlay"), "범용 negative에 text overlay");
  assert(mapNeg.includes("watermark"), "범용 negative에 watermark");

  const productNeg = buildNegativePrompt({
    scenePrompt: "A phone on a table",
    shotCategory: "product-shot",
    userNegativePrompt: "no glare, no reflection",
    durationSec: 8,
    styleIntensity: 50,
  });
  assert(productNeg.includes("abstract sculpture"), "product negative에 abstract sculpture");
  assert(productNeg.includes("no glare"), "사용자 negative 포함");
}

// ═══════════════════════════════════════════════════════════════
// TEST 9: 전체 6계층 조립 (assemblePromptV2)
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 9] 6계층 전체 조립 — map scene");
{
  const result = assemblePromptV2(
    {
      scenePrompt: "A flat antique paper map of East Asia with territorial overlays. Aged parchment texture. Trade routes marked in red ink.",
      shotCategory: "map-graphic",
      shotType: "WS",
      durationSec: 8,
      styleIntensity: 50,
    },
    {
      primarySubject: "the antique paper map",
      surfaceMaterial: "aged parchment",
    },
    "Cinematic color grading",
  );

  const fp = result.finalPrompt;
  assert(fp.length > 50, `프롬프트 길이: ${fp.length}자`);
  assert(result.wordCount > 20, `워드 카운트: ${result.wordCount}`);

  // Subject가 첫 문장에 있는지
  const firstSentence = fp.split(".")[0];
  assert(
    /map|parchment|antique/i.test(firstSentence),
    "첫 문장에 map/parchment 키워드 포함"
  );

  // Scene Lock 포함
  assert(fp.includes("not a landscape"), "scene lock 'not a landscape' 포함");

  // Continuity 포함
  assert(fp.includes("Same subject"), "continuity: Same subject 포함");

  // Negative 포함
  assert(fp.includes("Avoid:"), "negative block 포함");
  assert(fp.includes("landscape"), "negative에 landscape 포함");

  // 스타일이 마지막에만 약하게
  const styleIdx = fp.indexOf("Cinematic");
  const avoidIdx = fp.indexOf("Avoid:");
  if (styleIdx > 0 && avoidIdx > 0) {
    assert(styleIdx < avoidIdx, "스타일이 Avoid: 전에 위치");
  }

  // drift 평가 포함
  assert(result.driftAssessment.riskLevel !== undefined, "drift assessment 존재");

  console.log(`  📝 최종 프롬프트 (${result.wordCount}단어):`);
  console.log(`     ${fp.slice(0, 200)}…`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 10: 전체 6계층 조립 — character scene
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 10] 6계층 전체 조립 — character scene");
{
  const result = assemblePromptV2(
    {
      scenePrompt: "A middle-aged woman in a dark navy suit sits at a modern glass desk. She looks out the window. Soft warm afternoon light.",
      shotCategory: "character-driven",
      shotType: "MS",
      cameraDirection: "slow push-in toward her face",
      durationSec: 8,
      styleIntensity: 30,
    },
    {
      primarySubject: "middle-aged woman in navy suit",
      subjectAttributes: "short dark hair, reading glasses",
      environmentType: "modern office interior",
      lightingDirection: "warm afternoon light from right window",
    },
  );

  const fp = result.finalPrompt;
  assert(
    /woman|suit|desk/i.test(fp.split(".")[0]),
    "첫 문장에 character subject 포함"
  );
  assert(fp.includes("Same subject"), "continuity에 subject 유지");
  assert(fp.includes("slow push-in"), "카메라 방향 포함");
  assert(fp.includes("Avoid:"), "negative 포함");
  assert(fp.includes("extra limbs") || fp.includes("duplicate characters"), "character failure mode negative 포함");

  console.log(`  📝 최종 프롬프트 (${result.wordCount}단어):`);
  console.log(`     ${fp.slice(0, 200)}…`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 11: 추상 프롬프트 자동 교정
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 11] 추상 프롬프트 자동 교정");
{
  const result = assemblePromptV2(
    {
      scenePrompt: "Symbolic haunting dreamlike colonial power ominous surreal apocalyptic mood",
      shotCategory: "map-graphic",
      durationSec: 8,
      styleIntensity: 50,
    },
  );

  assert(result.driftAssessment.riskLevel === "high", "추상 프롬프트 → high risk");
  assert(result.driftAssessment.correctedPrompt !== undefined, "자동 교정 발생");

  const fp = result.finalPrompt;
  // 위험 단어가 제거/약화되었는지
  const dangerousCount = (fp.match(/\b(symbolic|haunting|dreamlike|ominous|surreal|apocalyptic)\b/gi) || []).length;
  assert(dangerousCount <= 2, `위험 단어 ${dangerousCount}개 이하로 제한됨`);

  console.log(`  📝 교정된 프롬프트: ${fp.slice(0, 150)}…`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 12: product shot 프롬프트
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 12] product shot 프롬프트");
{
  const result = assemblePromptV2(
    {
      scenePrompt: "A sleek silver laptop open on a minimal white desk. The screen shows a blue gradient. Clean studio lighting from above.",
      shotCategory: "product-shot",
      shotType: "MCU",
      durationSec: 6,
      styleIntensity: 20,
    },
  );

  const fp = result.finalPrompt;
  assert(/laptop|desk/i.test(fp.split(".")[0]), "첫 문장에 product subject");
  assert(fp.includes("not"), "scene lock에 'not' 제약");
  assert(fp.includes("Avoid:"), "negative 포함");

  console.log(`  📝 product 프롬프트 (${result.wordCount}단어): ${fp.slice(0, 150)}…`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 13: 스타일 힌트가 마지막에만 적용
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 13] 스타일 힌트 위치");
{
  const result = assemblePromptV2(
    {
      scenePrompt: "A narrow alley in Seoul at night with neon signs reflected on wet pavement.",
      shotCategory: "environment",
      shotType: "WS",
      durationSec: 8,
      styleIntensity: 80,
    },
    undefined,
    "Cinematic film noir lighting with dramatic shadows and high contrast",
  );

  const fp = result.finalPrompt;
  const subjectIdx = fp.indexOf("alley");
  const styleIdx = fp.indexOf("Cinematic");
  const avoidIdx = fp.indexOf("Avoid:");

  assert(subjectIdx >= 0, "subject(alley) 존재");
  assert(styleIdx >= 0, "스타일 힌트 존재");
  assert(subjectIdx < styleIdx, "subject가 스타일보다 먼저");
  if (avoidIdx > 0) {
    assert(styleIdx < avoidIdx, "스타일이 negative보다 먼저");
  }

  // 스타일 힌트가 15단어 이하로 압축
  assert(result.layers.styleHint.split(/\s+/).length <= 15, "스타일 힌트 15단어 이하");
}

// ═══════════════════════════════════════════════════════════════
// TEST 14: Temporal Action 빌더
// ═══════════════════════════════════════════════════════════════
console.log("\n[TEST 14] Temporal Action 빌더");
{
  const action = buildTemporalAction({
    scenePrompt: "A woman opens the door. She walks into the room. She sits down at the desk.",
    durationSec: 8,
    styleIntensity: 50,
  });
  assert(/\d+/.test(action), "temporal beats에 숫자 포함");
  assert(action.includes("opens") || action.includes("walks") || action.includes("sits"), "액션 키워드 포함");

  // 액션 없는 정적 씬
  const noAction = buildTemporalAction({
    scenePrompt: "A quiet room with warm lighting and wooden furniture.",
    durationSec: 8,
    styleIntensity: 50,
  });
  assert(/\d+/.test(noAction), "정적 씬에도 temporal beats 생성");
}

// ═══════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(50)}`);
console.log(`총 ${passed + failed}개 테스트: ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("모든 테스트 통과! ✓");
}
