import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { imageBase64: rawBase64, characterSeeds } = await context.request.json() as {
      imageBase64: string;
      characterSeeds?: { id: string; label: string; appearance: string }[];
    };

    if (!rawBase64) {
      return Response.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    // data:image/...;base64, 접두사 제거
    const imageBase64 = rawBase64.includes(",") ? rawBase64.split(",")[1] : rawBase64;
    // MIME 타입 추출
    const mimeMatch = rawBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

    const charInfo = characterSeeds && characterSeeds.length > 0
      ? characterSeeds.map((c) => `- ${c.id} (${c.label}): ${c.appearance}`).join("\n")
      : "- 등장하는 모든 인물의 얼굴을 감지해주세요";

    const prompt = `이 이미지에서 캐릭터의 얼굴 영역을 감지해주세요.

등장 캐릭터 정보:
${charInfo}

이미지의 전체 크기를 기준으로 각 캐릭터 얼굴의 바운딩 박스를 비율(0~1)로 반환해주세요.
얼굴 주변에 약간의 여백(머리카락, 목까지 포함)을 포함해주세요.

JSON으로만 응답:
{
  "faces": [
    {
      "characterId": "char-1",
      "label": "캐릭터 이름",
      "confidence": 0.95,
      "boundingBox": {
        "x": 0.3,
        "y": 0.1,
        "width": 0.4,
        "height": 0.5
      }
    }
  ]
}

얼굴이 없으면 빈 배열을 반환: { "faces": [] }`;

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3-flash-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini Vision error:", res.status, errText);
      return Response.json({ error: `Vision API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '{"faces":[]}';
    const result = JSON.parse(text);

    return Response.json(result);
  } catch (error) {
    console.error("Face extraction error:", error);
    return Response.json({ error: "Failed to extract faces" }, { status: 500 });
  }
};
