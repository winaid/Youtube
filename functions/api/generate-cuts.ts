interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const {
      storyText,
      directorName,
      directorNameKo,
      directorStyle,
      directorPersona,
      directorTechniques,
      animationMode,
      aspectRatio,
      region,
      cutCount,
    } = await context.request.json() as Record<string, string | number | object>;

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
      "수채화 애니": "watercolor painting animation, soft bleeding edges, pastel tones, hand-painted texture, Studio Ghibli background style, delicate brush strokes",
      "로토스코핑": "rotoscope animation style, traced over live-action footage, A Scanner Darkly aesthetic, fluid realistic motion with hand-drawn outlines, painterly filter",
      "스톱모션": "stop-motion animation, claymation texture, Laika Studios style, handcrafted miniature sets, visible fingerprints on clay, frame-by-frame movement",
      "픽셀아트": "pixel art animation, 16-bit retro game aesthetic, limited color palette, crisp pixel edges, chiptune era visual style, nostalgic game cutscene",
      "잉크워시": "East Asian ink wash painting animation, sumi-e brush strokes, black ink on rice paper texture, flowing calligraphic lines, minimalist zen aesthetic",
      "클레이": "clay animation, plasticine characters, handmade texture, Wallace and Gromit style, warm tactile quality, sculpted environments",
      "빈티지 필름": "vintage 1970s film stock, heavy grain, faded warm color palette, light leaks, lens flare, old projector artifacts, retro analog cinema",
      "네온 사이버펑크": "neon-drenched cyberpunk, rain-soaked streets, holographic signs, electric blue and hot pink palette, Blade Runner aesthetic, futuristic noir",
      "미니어처": "tilt-shift miniature effect, diorama style, shallow depth of field, toy-like proportions, Wes Anderson dollhouse aesthetic, everything looks tiny",
    };
    const veoStyle = veoStyleMap[String(animationMode)] || veoStyleMap["2D 애니"];

    const regionFlavorMap: Record<string, string> = {
      "한국": "Korean aesthetic, Korean urban-rural atmosphere",
      "일본": "Japanese aesthetic, traditional-modern contrast",
      "중국": "Chinese cinematic grandeur, classical architecture",
      "유럽": "European architecture, classical atmosphere",
      "미국": "American cinematic, diverse urban landscape",
      "인도": "Indian cinematic, vibrant colors, diverse cultural landscape",
      "중동": "Middle Eastern aesthetic, desert and ancient architecture, warm tones",
      "동남아": "Southeast Asian tropical atmosphere, lush greenery, vibrant street life",
      "중남미": "Latin American magical realism, vivid colors, colonial architecture",
      "아프리카": "African landscape, warm earth tones, diverse cultural patterns",
      "오세아니아": "Oceanian vast landscapes, dramatic natural scenery, epic wilderness",
    };
    const regionFlavor = regionFlavorMap[String(region)] || regionFlavorMap["한국"];

    // Parse director techniques if available
    const techniques = directorTechniques && typeof directorTechniques === "object"
      ? directorTechniques as Record<string, string>
      : null;
    const isLongTakeDirector = techniques?.editingStyle?.toLowerCase().includes("long take")
      || techniques?.editingStyle?.toLowerCase().includes("long shot")
      || techniques?.cameraWork?.toLowerCase().includes("long tracking")
      || techniques?.cameraWork?.toLowerCase().includes("oner");
    const isFastCutDirector = techniques?.editingStyle?.toLowerCase().includes("fast cut")
      || techniques?.editingStyle?.toLowerCase().includes("rapid")
      || techniques?.editingStyle?.toLowerCase().includes("quick")
      || techniques?.editingStyle?.toLowerCase().includes("montage");

    const editingPhilosophy = isLongTakeDirector
      ? `이 감독은 롱테이크의 대가입니다. 장면 수를 최소화하고(목표의 60~70%), 한 장면 안에서 카메라가 끊김 없이 긴 호흡으로 움직이세요. 8초 전체를 하나의 연속 촬영처럼.`
      : isFastCutDirector
        ? `이 감독은 빠른 편집의 대가입니다. 장면 수를 목표만큼 또는 그 이상(최대 120%) 만들되, 각 장면 안에서도 빠른 앵글 전환과 역동적 카메라 무빙을 넣으세요. 에너지!`
        : `이 감독의 편집 리듬에 맞춰 장면을 구성하세요.`;

    const techniquesBlock = techniques
      ? `\n## 감독 시그니처 기법 (검색 분석 결과)
- 카메라 워크: ${techniques.cameraWork || "N/A"}
- 색감/색보정: ${techniques.colorPalette || "N/A"}
- 조명: ${techniques.lighting || "N/A"}
- 편집 스타일: ${techniques.editingStyle || "N/A"}
- 무드: ${techniques.moodKeywords || "N/A"}
→ ${editingPhilosophy}`
      : "";

    const prompt = `당신은 **AI 영상 감독**입니다. 이름은 없지만, 당신만의 철학이 있습니다:
"한 장면 안에서 카메라가 숨 쉬듯 움직여야 한다. 컷을 많이 나누는 건 게으른 연출이다. 하나의 8초 장면 안에 시작-전개-임팩트를 모두 담아야 진짜 영상이다."

당신은 ${directorNameKo || directorName} 감독의 스타일을 깊이 연구하고 체화한 AI입니다.
${directorPersona ? `\n${directorNameKo}의 페르소나:\n${String(directorPersona).slice(0, 800)}` : ""}
${techniquesBlock}

## 당신의 연출 원칙
1. **원 씬 원 스토리**: 8초 안에 하나의 완결된 이야기 비트(beat)를 담는다
2. **카메라는 살아있다**: 한 장면에서 반드시 2~3가지 카메라 무빙을 조합한다
   - 예: "Wide establishing → slow dolly in → rack focus to hands" (하나의 8초 안에서)
   - 예: "Low angle tracking → whip pan → settle on close-up" (하나의 8초 안에서)
3. **적은 장면, 높은 밀도**: 장면 수를 최소화하되, 각 장면의 정보 밀도를 극대화한다
4. **감독 스타일 일체화**: ${directorNameKo}의 시그니처를 모든 장면에 녹인다
   - 스타일: ${directorStyle || "시네마틱"}

## 프로젝트 설정
- 애니메이션: ${animationMode || "2D 애니"} → Veo: ${veoStyle}
- 화면비: ${aspectRatio || "1:1"} | 지역: ${regionFlavor}
- 목표 장면 수: ${cutCount || 8} (이보다 적게 만들어도 됨! 밀도가 중요)

## 시나리오
${String(storyText).slice(0, 3000)}

---

## STEP 1: 캐릭터 정의
시나리오의 모든 캐릭터를 **영어 고정 묘사**로 정의.
이 묘사는 모든 장면 프롬프트에 100% 동일하게 반복됩니다. 절대 축약 금지.

포함 항목: 성별, 나이대, 머리(스타일+색), 얼굴 특징, 체형, 의상(색+소재+디테일), 피부톤
예시: "A young Korean man in his late 20s, short black hair with side part, sharp jawline, slim athletic build, wearing a navy blue cotton hoodie with white drawstrings and dark grey slim jeans, warm ivory skin tone"

## STEP 2: 장면 생성 (핵심!)

**한 장면 = 8초 영상 클립. 이 안에서 카메라가 자유롭게 움직인다!**

각 장면의 videoPrompt에는 반드시:
- **카메라 시퀀스**: 8초 안에서 2~3가지 카메라 무빙을 시간순으로 기술
  "Camera starts with [앵글1], then [무빙1] into [앵글2], finally [무빙2] settling on [앵글3]"
- **동작 시퀀스**: 캐릭터/배경이 8초 동안 어떻게 변화하는지 시간순 기술
- **감독 시그니처**: ${directorNameKo}의 특징적 기법 1~2개

**캐릭터 일관성:**
- 모든 프롬프트에 캐릭터 전체 외형 묘사를 매번 100% 반복
- "same character" 등 참조 표현 절대 금지
- 의상, 헤어, 체형, 피부톤 불변

**Extend 프롬프트 (장면 연결):**
- 장면 1: extendPrompt = ""
- 장면 2+: 이전 장면의 마지막 프레임을 구체적으로 묘사하며 이어가기
- "Continue" 같은 모호한 표현 금지

---

## 출력 JSON (마크다운 펜스 없이 순수 JSON만)

{
  "characterSeeds": [{
    "id": "char-1",
    "label": "[한국어 이름/역할]",
    "appearance": "[영어 전체 외형 — STEP 1]",
    "appearanceKo": "[한국어 외형 요약]"
  }],
  "cuts": [{
    "cutNumber": 1,
    "durationSec": 8,
    "sceneDescription": "[한국어] 장면 내용 + 카메라 움직임 한줄 설명",
    "cameraDirection": "[영어] 8초 카메라 시퀀스: [앵글1]→[무빙]→[앵글2]→[무빙]→[앵글3]. ${directorNameKo} style.",
    "moodLighting": "[영어] 조명/분위기 — 감독 스타일",
    "imagePrompt": "[영어] ${veoStyle}, ${regionFlavor}, directed by ${directorName}, [캐릭터 전체 외형], [장면 핵심 순간], [조명], cinematic quality, ${aspectRatio || "1:1"} aspect ratio, no text, no watermark",
    "videoPrompt": "[영어] Cinematic 8-second single-take clip. ${veoStyle}. Directed by ${directorName}. Camera: [시작 앵글], [첫 무빙], [중간 앵글], [두번째 무빙], [최종 앵글]. [캐릭터 전체 외형]. [8초 동안의 동작 시퀀스]. [조명 변화]. Smooth continuous motion, ${aspectRatio || "1:1"}, no text, no watermark",
    "extendPrompt": "",
    "transitionHint": "[한국어] 다음 장면 연결 방식",
    "characterConsistency": "[한국어] 캐릭터 유지 지침",
    "charactersInScene": ["char-1"]
  }]
}

JSON만 출력. 설명/마크다운 펜스/주석 없이.`;

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
