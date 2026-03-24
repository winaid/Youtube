/**
 * E2E 테스트: 페인리스 파커 시나리오 → Gemini → 영상 프롬프트 생성
 * 실행: npx tsx tests/painless-parker-e2e.ts
 */

const API_KEY = "AIzaSyCFdhO-04tu0hywvWEA0XgDtS2qZvqQyhQ";
const MODEL = "gemini-2.5-flash";

const STORY_TEXT = `치과 가면 무서워서 손에 땀나는 사람 손? 사실 치과 공포증 마케팅, 100년 전부터 있었음. 바로 '페인리스 파커'의 기상천외한 거리 광고 전략임. ㅋㅋ

이 사람, 처음 개원했을 땐 손님 한 명 없었음. 근데 서커스단 운영 방식을 치과에 도입하면서 대박이 남.

마차에 브라스 밴드랑 쇼걸을 태우고 광장으로 나감. 사람들 모아놓고 "안 아프게 뽑아준다"며 공개 발치 쇼를 벌임. 비명 소리 들릴까 봐 밴드 연주 소리를 더 키우는 센스까지 발휘함. ㅋㅋ

진짜 압권은 '무통 보장' 마케팅임. "아프면 5달러 준다"고 호언장담했는데, 사실 미리 뽑아둔 치아를 입에 숨긴 알바생을 써서 마치 안 아픈 것처럼 '쇼'를 한 거임.

결국 이 이름 때문에 소송까지 걸렸는데, 아예 법적 이름을 '페인리스(Painless, 고통 없는)'로 바꿔버림. 이름 자체가 브랜드가 된 거지. ㅋㅋ

물론 현대 의학 관점에선 너무 자극적이지만, 환자의 두려움을 정확히 파고든 그 마케팅만큼은 지금 봐도 소름 돋을 정도로 파격적임.

결국 실력도 실력이지만, 사람들이 뭘 무서워하고 뭘 원하는지 정확히 아는 게 마케팅의 핵심이라는 거임. ㅋㅋ`;

const SYSTEM_PROMPT = `당신은 영상 감독 스타일로 장면을 구조화하는 시나리오 분석가입니다.

입력: 쇼츠용 한국어 내레이션 스크립트
출력: 각 컷별 영어 영상 프롬프트 (VEO 영상 생성용)

규칙:
1. 각 컷은 8초 VEO 영상 1개에 대응
2. 프롬프트는 반드시 영어로 작성 (한국어 금지 - VEO가 자막으로 렌더링함)
3. 강사/발표자/해설자 캐릭터 생성 금지
4. 카메라를 향해 설명하는 인물 금지
5. 시나리오의 모든 핵심 논점이 최소 1개 컷에 반영되어야 함

각 컷에는:
- shotType: 카메라 샷 사이즈 (WS, MS, CU, MCU 등)
- videoPrompt: 영어 시각 묘사 (VEO용)
- videoPromptKo: 한국어 요약 (UI 표시용)
- narrativeFunction: 이 컷의 서사 기능

출력 JSON:
{
  "_narrativeCore": "핵심 주장 1문장 (한국어 ≤30자)",
  "_targetEmotions": ["emotion1", "emotion2"],
  "characterSeeds": [
    { "id": "char-1", "label": "한국어 이름/역할", "appearance": "English ≤40 words" }
  ],
  "cuts": [
    {
      "index": 1,
      "shotType": "WS",
      "narrativeFunction": "배경 설정",
      "newInformation": "English ≤12 words",
      "videoPrompt": "English visual description for VEO, ≤80 words",
      "videoPromptKo": "한국어 장면 요약 ≤40자",
      "subjectAction": "what the subject physically does",
      "moodLighting": "lighting description"
    }
  ]
}`;

async function main() {
  console.log("🎬 페인리스 파커 시나리오 → 영상 프롬프트 생성 테스트\n");
  console.log(`모델: ${MODEL}`);
  console.log(`시나리오 길이: ${STORY_TEXT.length}자\n`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: "user",
      parts: [{
        text: `## 시나리오\n${STORY_TEXT}\n\n조건: 8초/시퀀스, 총 6시퀀스. 감독 스타일: cinematic realism.\n\n위 시나리오를 6개 컷의 영상 프롬프트로 변환해주세요. JSON으로 출력.`
      }]
    }],
    generationConfig: {
      temperature: 1.0,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };

  console.log("⏳ Gemini API 호출 중...\n");
  const t0 = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const elapsed = Date.now() - t0;
  console.log(`✅ 응답 수신 (${elapsed}ms, status=${res.status})\n`);

  if (!res.ok) {
    const errText = await res.text();
    console.error("❌ API 에러:", errText.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error("❌ 응답에 텍스트 없음:", JSON.stringify(data).slice(0, 300));
    process.exit(1);
  }

  // JSON 파싱
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(text);
  } catch {
    console.log("⚠️ JSON 파싱 실패, 원문 출력:\n");
    console.log(text);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("📋 생성 결과 요약");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`🎯 핵심 주장: ${result._narrativeCore}`);
  console.log(`💭 목표 감정: ${JSON.stringify(result._targetEmotions)}`);

  const seeds = result.characterSeeds as Array<Record<string, string>> | undefined;
  if (seeds) {
    console.log(`\n👤 캐릭터 시드 (${seeds.length}명):`);
    for (const s of seeds) {
      console.log(`   - ${s.label}: ${s.appearance}`);
    }
  }

  const cuts = result.cuts as Array<Record<string, unknown>> | undefined;
  if (cuts) {
    console.log(`\n🎬 컷 프롬프트 (${cuts.length}개):\n`);
    for (const cut of cuts) {
      console.log(`── 컷 ${cut.index} [${cut.shotType}] ${cut.narrativeFunction} ──`);
      console.log(`   📝 KO: ${cut.videoPromptKo}`);
      console.log(`   🎥 EN: ${cut.videoPrompt}`);
      console.log(`   🏃 Action: ${cut.subjectAction}`);
      console.log(`   💡 Light: ${cut.moodLighting}`);
      console.log(`   🆕 New info: ${cut.newInformation}`);
      console.log();
    }
  }

  // 품질 체크
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔍 품질 검증");
  console.log("═══════════════════════════════════════════════════════\n");

  let issues = 0;

  if (cuts) {
    for (const cut of cuts) {
      const prompt = String(cut.videoPrompt || "");
      // 한국어 잔류 체크
      const koreanMatch = prompt.match(/[\uAC00-\uD7A3]/g);
      if (koreanMatch) {
        console.log(`❌ 컷 ${cut.index}: 한국어 텍스트 잔류 (${koreanMatch.length}자)`);
        issues++;
      }
      // 프롬프트 길이 체크
      if (prompt.split(/\s+/).length < 10) {
        console.log(`⚠️ 컷 ${cut.index}: 프롬프트가 너무 짧음 (${prompt.split(/\s+/).length} words)`);
        issues++;
      }
      // 강사/발표자 패턴 체크
      if (/\b(lecturer|presenter|host|narrator|speaks to camera|looking at camera|addressing)\b/i.test(prompt)) {
        console.log(`❌ 컷 ${cut.index}: 강사/발표자 패턴 검출 — "${prompt.match(/\b(lecturer|presenter|host|narrator|speaks to camera|looking at camera|addressing)\b/i)?.[0]}"`);
        issues++;
      }
    }
  }

  if (issues === 0) {
    console.log("✅ 모든 품질 검증 통과!");
  } else {
    console.log(`\n⚠️ ${issues}개 이슈 발견`);
  }
}

main().catch(console.error);
