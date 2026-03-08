import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

const GEMINI_API_URL =
  "https://aiplatform.googleapis.com/v1beta/publishers/google/models/gemini-3.1-pro:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { scenes } = await context.request.json() as {
      scenes: {
        cutNumber: number;
        sceneDescription: string;
        moodLighting: string;
        cameraDirection: string;
      }[];
    };

    if (!scenes || scenes.length === 0) {
      return Response.json({ error: "scenes are required" }, { status: 400 });
    }

    const sceneList = scenes
      .map(
        (s) =>
          `장면${s.cutNumber}: ${s.sceneDescription} (조명: ${s.moodLighting}, 카메라: ${s.cameraDirection})`
      )
      .join("\n");

    const prompt = `당신은 유튜브 영상 효과음 전문가입니다. 유행하는 밈 효과음, 바이럴 효과음을 잘 알고 있습니다.

아래 장면들을 분석하여 각 장면에 어울리는 효과음을 매칭해주세요.

장면 목록:
${sceneList}

사용 가능한 효과음 카테고리:
- impact: 빰! 등장, 베이스 드롭, 드라마틱 히트 (강렬한 등장, 반전, 충격 장면)
- whoosh: 슈우웅 전환, 빠른 스우시 (장면 전환, 빠른 이동)
- comedy: 바인 붐, 브러, 귀뚜라미, 슬픈 트럼본, 웃음소리 (웃긴 장면, 어색한 순간, 리액션)
- suspense: 서스펜스 히트, 호러 드론, 심장 박동 (긴장, 공포, 미스터리)
- success: 레벨업, 업적 달성, 카-칭 (성공, 보상, 돈)
- notification: 알림 팝업, 메시지 수신 (디지털, 소셜미디어, 텍스트 등장)
- ambient: 비, 천둥, 바람, 파도 (자연 환경음)
- action: 펀치 타격, 폭발, 검 베기 (액션, 전투)
- emotional: 반짝 효과, 피아노 감성, 시계 째깍 (감동, 시간 경과, 마법)
- viral: 띵! 정답, 삐~! 오답, 레코드 스크래치, 오 노~ (밈, 퀴즈, 바이럴)

규칙:
1. 각 장면에 1~3개의 효과음 카테고리를 매칭
2. 유튜브에서 유행하는 효과음을 우선 추천
3. 효과음이 필요 없는 조용한 장면은 빈 배열로
4. 각 효과음의 삽입 타이밍도 지정

JSON으로만 응답:
{
  "matches": [
    {
      "cutNumber": 1,
      "sfxCategories": ["impact", "whoosh"],
      "specificSfx": ["sfx-boom-impact", "sfx-whoosh"],
      "timing": "장면 시작 시 임팩트, 카메라 이동 시 우시",
      "reason": "강렬한 첫 등장 장면이므로 임팩트 효과음 + 카메라 무빙에 우시"
    }
  ]
}

사용 가능한 sfx ID:
impact: sfx-boom-impact, sfx-bass-drop, sfx-dramatic-hit
whoosh: sfx-whoosh, sfx-swoosh-fast
comedy: sfx-vine-boom, sfx-bruh, sfx-crickets, sfx-sad-trombone, sfx-laugh-track
suspense: sfx-suspense-hit, sfx-horror-drone, sfx-heartbeat
success: sfx-level-up, sfx-achievement, sfx-cash-register
notification: sfx-notification, sfx-message-pop
ambient: sfx-rain, sfx-thunder, sfx-wind, sfx-ocean-waves
action: sfx-punch, sfx-explosion, sfx-sword-slash
emotional: sfx-sparkle, sfx-piano-hit, sfx-clock-ticking
viral: sfx-ding, sfx-wrong-buzzer, sfx-record-scratch, sfx-tik-tok-oh-no`;

    const res = await fetchWithAuth(context.env, GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini SFX API error:", res.status, errText);
      return Response.json({ error: `API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '{"matches":[]}';
    const result = JSON.parse(text);

    return Response.json(result);
  } catch (error) {
    console.error("SFX matching error:", error);
    return Response.json({ error: "Failed to match SFX" }, { status: 500 });
  }
};
