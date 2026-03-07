interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const {
      storyText,
      directorName,
      directorNameKo,
      directorStyle,
      directorPersona,
      animationMode,
      aspectRatio,
      region,
      cutCount,
    } = await context.request.json() as Record<string, string | number>;

    if (!storyText || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const veoStyleMap: Record<string, string> = {
      "2D 애니": "2D anime style, cel-shaded animation, vibrant colors, anime character design",
      "실사": "photorealistic, cinematic film grain, 4K quality, real human actors",
      "하이브리드": "hybrid 2D-3D rendering, stylized semi-realistic, blending anime and live-action",
    };
    const veoStyle = veoStyleMap[String(animationMode)] || veoStyleMap["2D 애니"];

    const regionFlavorMap: Record<string, string> = {
      "한국": "Korean aesthetic, Korean urban-rural atmosphere",
      "일본": "Japanese aesthetic, traditional-modern contrast",
      "중국": "Chinese cinematic grandeur, classical architecture",
      "유럽": "European architecture, classical atmosphere",
      "미국": "American cinematic, diverse urban landscape",
    };
    const regionFlavor = regionFlavorMap[String(region)] || regionFlavorMap["한국"];

    const prompt = `당신은 Google Veo 영상 프롬프트 전문가이자 영상 연출가입니다.

## 감독 정보
- 감독: ${directorNameKo || directorName} (${directorName})
- 연출 스타일: ${directorStyle || "시네마틱"}
${directorPersona ? `- 감독 페르소나: ${String(directorPersona).slice(0, 500)}` : ""}

## 프로젝트 설정
- 애니메이션 모드: ${animationMode || "2D 애니"}
- Veo 스타일: ${veoStyle}
- 화면비: ${aspectRatio || "1:1"}
- 지역 감성: ${regionFlavor}
- 컷 수: ${cutCount || 8}

## 시나리오
${String(storyText).slice(0, 3000)}

---

## 작업 순서

### STEP 1: 캐릭터 정의
시나리오에 등장하는 모든 캐릭터를 먼저 정의하세요.
각 캐릭터의 외형을 **구체적이고 고정된 영어 묘사**로 작성합니다.
이 묘사는 모든 컷의 프롬프트에 동일하게 반복 삽입됩니다.

캐릭터 묘사에 반드시 포함할 항목:
- 성별, 나이대
- 머리 스타일과 색상
- 얼굴 특징 (눈, 코, 입 등 주요 특징)
- 체형
- 의상 (색상, 소재, 디테일까지 구체적으로)
- 피부톤

예시: "A young Korean man in his late 20s, short black hair with side part, sharp jawline, slim athletic build, wearing a navy blue cotton hoodie with white drawstrings and dark grey slim jeans, warm ivory skin tone"

### STEP 2: 컷 생성
${Number(cutCount) || 8}개의 컷을 생성합니다.

**핵심 규칙 — 캐릭터 일관성:**
- 모든 컷의 videoPrompt, imagePrompt, extendPrompt에 해당 컷에 등장하는 캐릭터의 **전체 외형 묘사를 매번 반복**해서 넣으세요
- "same character as before" 같은 참조 표현 절대 금지. 항상 전체 묘사를 다시 써야 합니다
- 캐릭터의 의상, 헤어, 체형이 컷 간에 절대 변하면 안 됩니다

**핵심 규칙 — 감독 스타일:**
- 모든 videoPrompt와 imagePrompt에 감독의 시그니처 스타일 키워드를 포함하세요
- ${directorNameKo}의 특징: ${directorStyle}
- 카메라 워크, 색감, 조명, 구도에 감독 스타일을 반영하세요

**핵심 규칙 — Extend 프롬프트:**
- CUT 1: extendPrompt는 빈 문자열 ""
- CUT 2 이후: extendPrompt는 **이전 컷의 마지막 장면에서 자연스럽게 이어지는** 묘사
- extendPrompt에도 캐릭터 전체 외형 묘사를 반드시 포함
- "Continue from previous clip" 같은 모호한 표현 금지. 구체적으로 어떤 장면에서 어떻게 이어지는지 묘사

---

## 출력 형식

다음 JSON 구조로 출력하세요. 마크다운 펜스 없이 순수 JSON만:

{
  "characterSeeds": [
    {
      "id": "char-1",
      "label": "[한국어 캐릭터 이름/역할]",
      "appearance": "[영어 전체 외형 묘사 — 위 STEP 1에서 정의한 것]",
      "appearanceKo": "[한국어 외형 요약]"
    }
  ],
  "cuts": [
    {
      "cutNumber": 1,
      "durationSec": 8,
      "sceneDescription": "[한국어] 이 컷의 장면 설명",
      "cameraDirection": "[영어] 카메라 무빙 — 감독 스타일 반영",
      "moodLighting": "[영어] 조명/분위기 — 감독 스타일 반영",
      "imagePrompt": "[영어] ${veoStyle}, ${regionFlavor}, [감독 스타일 키워드], [캐릭터 전체 외형 묘사], [장면 묘사], [조명], [구도], cinematic quality, ${aspectRatio || "1:1"} aspect ratio, no text overlay, no watermark",
      "videoPrompt": "[영어] Cinematic 8-second clip. ${veoStyle}. [감독 스타일 키워드 + 카메라 동작]. [캐릭터 전체 외형 묘사]. [장면 동작 묘사]. [조명/분위기]. Smooth motion, ${aspectRatio || "1:1"} aspect ratio, no text, no watermark",
      "extendPrompt": "",
      "transitionHint": "[한국어] 다음 컷으로의 전환 방식",
      "characterConsistency": "[한국어] 이 컷의 캐릭터 유지 지침",
      "charactersInScene": ["char-1"]
    },
    {
      "cutNumber": 2,
      "extendPrompt": "[영어] The scene continues from [이전 컷 마지막 장면 구체 묘사]. [캐릭터 전체 외형 묘사 반복]. [이번 컷 동작]. [감독 스타일]. ${veoStyle}. Smooth transition, maintain exact character appearance, ${aspectRatio || "1:1"} aspect ratio",
      "...": "나머지 필드도 동일"
    }
  ]
}

중요: JSON만 출력. 설명, 마크다운 펜스, 주석 없이.`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 16384 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try extracting JSON from markdown fences or other wrapper
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        parsed = arrayMatch ? { cuts: JSON.parse(arrayMatch[0]), characterSeeds: [] } : { cuts: [], characterSeeds: [] };
      }
    }

    const characterSeeds = Array.isArray(parsed.characterSeeds) ? parsed.characterSeeds : [];
    const cuts = Array.isArray(parsed.cuts) ? parsed.cuts : (Array.isArray(parsed) ? parsed : []);

    return Response.json({ characterSeeds, cuts });
  } catch (error) {
    console.error("Cuts generation error:", error);
    return Response.json({ error: "Failed to generate cuts" }, { status: 500 });
  }
};
