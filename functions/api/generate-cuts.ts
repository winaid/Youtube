import { GeminiEnv, streamingGenerate } from "./_gemini-keys";

type Env = GeminiEnv;

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

    // 국가별 시네마토그래피 스타일 + 전통 연출 기법
    const regionCinemaMap: Record<string, { flavor: string; signature: string }> = {
      "한국": {
        flavor: "Korean aesthetic, Korean urban-rural atmosphere",
        signature: `Korean Cinema Techniques:
- 한국식 정적 롱테이크 (static long take with character blocking within frame)
- 거울/유리 반사 프레이밍 (mirror/glass reflection framing for duality)
- 계절감 강조 (cherry blossoms, monsoon rain, autumn ginkgo, winter frost as emotional metaphor)
- 한옥/골목길 depth composition (traditional hanok architecture leading lines)
- 옥상 위 wide shot (rooftop wide establishing shot — signature K-drama composition)
- 형광등/네온 실내 조명 (fluorescent/neon interior lighting for mundane realism)
- 식탁 장면 overhead shot (dining table overhead — Korean family dynamic shot)`,
      },
      "일본": {
        flavor: "Japanese aesthetic, traditional-modern contrast",
        signature: `Japanese Cinema Techniques:
- 다다미 샷 tatami shot (camera at floor level ~30cm, Ozu Yasujiro signature, looking up at seated characters)
- 필로우 샷 pillow shot (cutaway to empty space/nature — kettle, sky, alley — for emotional pause)
- 마 (間) spacing (deliberate empty frames, negative space as storytelling)
- 엔가와 프레이밍 engawa framing (porch/veranda frames character against garden, inside-outside duality)
- 쇼지 스크린 shot (translucent sliding door silhouette, diffused backlight)
- 仰角 low angle with ceiling beams (looking up through wooden architecture)
- 四季 seasonal color grading (sakura pink, summer green, momiji red, snow white)
- 雨の scene (rain as emotional punctuation, wet surface reflections)
- 新幹線/電車 window reflection shot (train window framing, landscape passing)`,
      },
      "중국": {
        flavor: "Chinese cinematic grandeur, classical architecture",
        signature: `Chinese Cinema Techniques:
- 武侠 wuxia wire-frame composition (characters suspended in air, bamboo forest depth)
- 水墨画 ink wash transition (dissolve to ink painting aesthetic)
- 圆门 moon gate framing (circular doorway frames subject)
- 长廊 corridor tracking shot (palace/temple long corridor perspective)
- 山水 landscape establishing (epic mountain-water panorama, mist layers)
- 红色 red motif (red lanterns, fabric as emotional accent color)
- 茶道 ceremony overhead (ritual top-down shot, hands and objects)`,
      },
      "유럽": {
        flavor: "European architecture, classical atmosphere",
        signature: `European Cinema Techniques:
- French New Wave jump cut (discontinuous editing within scene for restlessness)
- Nouvelle Vague handheld naturalism (shaky intimate camera, available light)
- German Expressionist angle (Dutch angle, extreme shadow, Caligari distortion)
- Italian Neorealist street shot (on-location, non-studio, raw documentary feel)
- Scandinavian negative space (vast empty landscape, isolated figure, Bergman-style face close-up)
- Spanish surrealist composition (Buñuel/Almodóvar — bold color, absurd juxtaposition)
- British kitchen sink realism (gritty working-class interiors, overcast natural light)`,
      },
      "미국": {
        flavor: "American cinematic, diverse urban landscape",
        signature: `American Cinema Techniques:
- Hollywood three-point lighting (key, fill, back light — classic glamour setup)
- Spielberg face (awe-lit face from below, wide eyes, push-in dolly)
- Kubrick one-point perspective (symmetrical vanishing point corridor/hallway)
- Michael Bay low-angle hero shot (tilted up, golden hour backlight, slow-mo)
- Tarantino trunk shot (POV from inside car trunk looking up)
- Coen Brothers wide master (static wide shot, characters small in frame)
- Malick magic hour (golden/blue hour, backlit nature, existential voiceover framing)
- Wes Anderson centered symmetry (geometric framing, pastel palette, flat staging)`,
      },
      "인도": {
        flavor: "Indian cinematic, vibrant colors, diverse cultural landscape",
        signature: `Indian Cinema Techniques:
- Bollywood frontal staging (characters face camera directly, theatrical blocking)
- Sari/fabric color explosion (saturated costume colors against environment)
- Festival crowd aerial shot (drone/crane over massive celebration)
- Monsoon rain dance framing (rain as joy, slow-motion water droplets)
- Temple/palace symmetry shot (architectural symmetry with human figure center)
- Auto-rickshaw tracking shot (chaotic street following through traffic)`,
      },
      "중동": {
        flavor: "Middle Eastern aesthetic, desert and ancient architecture, warm tones",
        signature: `Middle Eastern Cinema Techniques:
- Desert horizon wide (vast sand/sky ratio, figure tiny against landscape)
- Souk/bazaar tracking (narrow market corridor, dappled fabric light overhead)
- Arabesque pattern frame (geometric Islamic art as natural framing device)
- Muezzin call atmosphere (dawn/dusk skyline silhouette, minaret backlit)
- Sandstorm atmosphere (amber haze, reduced visibility, dramatic reveal)`,
      },
      "동남아": {
        flavor: "Southeast Asian tropical atmosphere, lush greenery, vibrant street life",
        signature: `Southeast Asian Cinema Techniques:
- Tropical rain downpour shot (heavy rain curtain, characters under corrugated roof)
- Floating market tracking (camera gliding over water, vendor boats)
- Temple golden hour (Buddhist/Hindu temple backlit, warm glow on stone)
- Motorbike POV tracking (handheld following through crowded streets)
- Rice paddy aerial (drone ascending from field worker to vast green grid)`,
      },
      "중남미": {
        flavor: "Latin American magical realism, vivid colors, colonial architecture",
        signature: `Latin American Cinema Techniques:
- Magical realism transition (realistic scene dissolves into surreal/fantastical)
- Favela/barrio vertical shot (stacked colorful houses, vertigo framing)
- Día de los Muertos color burst (marigold orange, skeleton face paint, candlelight)
- Colonial courtyard framing (archway frames interior garden, fountain center)
- Carnival chaos tracking (handheld through dense celebration, confetti)`,
      },
      "아프리카": {
        flavor: "African landscape, warm earth tones, diverse cultural patterns",
        signature: `African Cinema Techniques:
- Savanna golden hour wide (animal/human silhouette against sunset sky)
- Market textile color tapestry (overhead shot of colorful fabrics/spices)
- Baobab tree framing (ancient tree frames character, roots as leading lines)
- Rhythm-driven editing (cut timing matches drum/percussion beat)
- Community circle shot (characters arranged in circle, rotating camera)`,
      },
      "오세아니아": {
        flavor: "Oceanian vast landscapes, dramatic natural scenery, epic wilderness",
        signature: `Oceanian Cinema Techniques:
- Epic landscape establishing (massive mountain/coastline dwarfing human figure)
- Underwater-to-surface transition (camera breaks water surface, world transforms)
- Aboriginal dreamtime aesthetic (earth tones, rock art patterns, time-lapse sky)
- Volcanic landscape drama (steam/lava glow, silhouette against geological power)`,
      },
    };
    const regionData = regionCinemaMap[String(region)] || regionCinemaMap["한국"];
    const regionFlavor = regionData.flavor;
    const regionSignature = regionData.signature;

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
      ? `이 감독은 롱테이크의 대가입니다. 장면 수는 정확히 목표 수만큼 만들되, 각 장면 안에서 카메라가 끊김 없이 긴 호흡으로 움직이도록 하세요. 8초 전체를 하나의 연속 촬영처럼.`
      : isFastCutDirector
        ? `이 감독은 빠른 편집의 대가입니다. 장면 수는 정확히 목표 수만큼 만들되, 각 장면 안에서도 빠른 앵글 전환과 역동적 카메라 무빙을 넣으세요. 에너지!`
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
3. **정확한 장면 수, 높은 밀도**: 장면 수는 반드시 목표 수와 정확히 일치시키되, 각 장면의 정보 밀도를 극대화한다
4. **감독 스타일 일체화**: ${directorNameKo}의 시그니처를 모든 장면에 녹인다
   - 스타일: ${directorStyle || "시네마틱"}

## 프로젝트 설정
- 애니메이션: ${animationMode || "2D 애니"} → Veo: ${veoStyle}
- 화면비: ${aspectRatio || "1:1"} | 지역: ${regionFlavor}
- 목표 장면 수: **정확히 ${cutCount || 8}개** — 절대 이보다 적거나 많으면 안 됨

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

**프롬프트 길이 최적화 (중요!):**
- 각 videoPrompt는 반드시 150~300 단어 (영어 기준)
- 100단어 미만: Veo가 디테일 부족으로 저품질 생성 → 카메라/조명/질감 묘사 추가
- 350단어 초과: Veo가 혼란 → 핵심만 압축
- 최적 구조: [카메라 2~3문장] + [캐릭터/액션 2~3문장] + [조명/분위기 1~2문장] + [스타일 키워드 1문장]

**!!!! 절대 규칙: imagePrompt, videoPrompt, extendPrompt는 100% 영어만 !!!!**
- 한국어 단어가 단 하나라도 들어가면 이미지/영상 생성이 실패합니다
- "역동적인 액션" ❌ → "dynamic action" ✅
- "기하학적 구도" ❌ → "geometric composition" ✅
- "날씨의 시각화" ❌ → "weather visualization" ✅
- "연극적 미장센" ❌ → "theatrical mise-en-scène" ✅
- 모든 스타일/분위기/카메라/조명 키워드는 반드시 영어로 번역

**imagePrompt는 반드시 실제 장면 내용을 묘사해야 합니다 (핵심!):**
- ❌ 나쁜 예: "photorealistic, cinematic, A young person, black hair, scene 1, cinematic quality"
- ✅ 좋은 예: "A young Korean woman sitting on her bed at night, scrolling through her phone reading plastic surgery reviews, phone screen glowing on her face, cozy bedroom with warm desk lamp, photorealistic, 4K"
- imagePrompt의 첫 문장은 반드시 "누가 어디서 무엇을 하고 있는지"를 구체적으로 묘사
- 스타일 키워드는 장면 묘사 뒤에 배치

**전문 촬영 용어를 적극 활용하라 (Veo 최적화 — 모두 영어로):**

### 조명 Lighting (반드시 매 장면 1~2개 사용):
- Rembrandt lighting (삼각형 그림자 — 인물 드라마 필수)
- butterfly lighting / paramount lighting (코 아래 나비 그림자 — 글래머)
- split lighting (얼굴 반반 — 내면 갈등)
- rim lighting / edge light (윤곽만 빛 — 실루엣 강조)
- chiaroscuro (명암 극대비 — 카라바조식)
- practical lighting (실제 소품 조명 — 촛불, 네온사인, 가로등)
- motivated lighting (장면 내 광원이 조명 이유 — 창문 빛, TV 빛)
- golden hour / magic hour (해질녘 따뜻한 빛)
- blue hour (해 진 직후 푸른 빛)
- volumetric light / god rays (빛기둥 — 먼지/안개 사이 빛줄기)
- bounce lighting (반사광 — 부드러운 간접 조명)
- top light / overhead light (위에서 아래로 — 심문, 고독)
- under lighting (아래에서 위로 — 공포, 괴기)
- kicker light (뒤쪽 옆에서 — 입체감 분리)
- cross lighting (교차 조명 — 양쪽에서 서로 다른 색온도)
- moonlight (달빛 — 은은한 블루 톤)
- neon glow (네온 — 사이버펑크, 도심 야경)

### 구도 Composition (반드시 매 장면 1개 이상):
- rule of thirds (삼분할)
- golden ratio / fibonacci spiral (황금비 나선)
- centered symmetry / Wes Anderson framing (정중앙 대칭)
- leading lines (시선 유도선 — 도로, 복도, 레일)
- frame within frame (창문, 문, 아치로 이중 프레임)
- negative space (여백의 미 — 캐릭터를 작게)
- deep staging / z-axis blocking (전경-중경-후경 레이어링)
- over-the-shoulder (어깨 너머 — 대화 씬)
- Dutch angle / canted angle (기울어진 프레임 — 불안)
- bird's eye view / top-down (새의 시점 — 조감)
- worm's eye view (벌레 시점 — 위압감)
- foreground occlusion (전경 장애물 뒤로 보이는 주체)
- silhouette framing (역광 실루엣)
- reflection framing (거울, 물, 유리 반사)

### 렌즈 Lens (장면 분위기에 맞게):
- wide angle 16mm (왜곡 있는 넓은 시야 — 공간감, 불안)
- 24mm wide (풍경 + 인물 밸런스)
- 35mm (인간 시야 — 자연스러운 다큐 느낌)
- 50mm standard (가장 자연스러운 원근 — 대화 씬)
- 85mm portrait (인물 클로즈업 — 배경 압축, 보케)
- 135mm telephoto (강한 배경 압축 — 인물 고립/스토킹 느낌)
- 200mm+ super telephoto (극단적 압축 — 군중 속 인물)
- anamorphic lens (시네마 와이드 + 타원형 보케 + 수평 플레어)
- tilt-shift lens (미니어처 효과 / 선택적 포커스 면)
- macro lens (극접사 — 눈물, 손가락, 디테일)
- fisheye (어안 — 극단적 왜곡, 서브컬처)

### 카메라 무빙 Camera Movement (8초 안에 2~3개 조합 필수):
- dolly in / dolly out (레일 전진/후진 — 감정 몰입/해방)
- tracking shot / lateral dolly (옆으로 따라가기)
- crane shot / jib up-down (수직 이동 — 로우→하이, 하이→로우)
- steadicam / gimbal follow (안정적 따라가기 — 복도, 거리)
- handheld (손떨림 — 긴장, 다큐, 리얼리즘)
- whip pan (빠른 수평 회전 — 전환, 놀람)
- push-in / zoom-in (서서히 다가가기 — 긴장 고조)
- pull-back / reveal (뒤로 빠지며 공간 드러내기)
- orbit / 360° arc (인물 주위 회전 — 시간 정지 느낌)
- vertigo / dolly zoom / Hitchcock zoom (달리 인+줌 아웃 동시 — 공간 왜곡)
- bird's eye to eye level (위에서 내려오기)
- rack focus (초점 이동 — A→B 시선 전환)
- snap zoom (급격한 줌 — 코미디/공포 강조)
- parallax (다른 속도로 움직이는 레이어 — 깊이감)

### 색보정 Color Grading:
- teal and orange (청록+주황 — 할리우드 표준 보색)
- bleach bypass / desaturated (탈색 — 전쟁, 회상)
- crushed blacks (어두운 부분 완전 검정 — 무드)
- lifted blacks (어두운 부분 회색 — 빈티지, 소프트)
- high contrast (강한 명암 — 드라마틱)
- low contrast / flat grade (낮은 대비 — 몽환, 회상)
- warm tone shift (따뜻한 톤 — 향수, 로맨스)
- cool tone shift (차가운 톤 — 고독, 미래)
- monochromatic (단색 — 흑백, 세피아, 블루 워시)
- complementary split tone (하이라이트/섀도우 다른 색 — 영화적)

### 지역 특화 연출 (이 프로젝트: ${region || "한국"}):
${regionSignature}

- NEVER use Korean in imagePrompt, videoPrompt, or extendPrompt — 100% English only
- CRITICAL: NEVER include any text, titles, captions, subtitles, watermarks, logos, stamps, calligraphy, written characters, signage text, or typographic elements in ANY prompt. The only exception is when the story explicitly requires a character to write/read something — even then, minimize text visibility. Always end every imagePrompt, endImagePrompt, videoPrompt, and extendPrompt with: "no text overlay, no titles, no captions, no watermark, no written characters, no calligraphy, no stamps, no logos"

각 장면의 videoPrompt에는 반드시 다음을 모두 포함:

**★★★ TEMPORAL BEATS — 가장 중요! Veo가 프롬프트를 따르려면 시간 구조 필수 ★★★**
- 반드시 "0s-2s: [시작], 2s-5s: [전개], 5s-8s: [클라이맥스]" 형식의 시간 비트 포함
- 각 시간대에 최대 2개의 동시 동작만 (과하면 Veo가 무시함)
- 예시: "0s-2s: Wide establishing shot, character stands alone in rain. 2s-5s: Slow dolly in as character raises hand to face, rain intensifies. 5s-8s: Close-up, eyes narrow with determination, lightning flash from behind."

- **조명 1~2개**: 위 조명 레퍼런스에서 장면에 맞는 것 선택 (예: "Rembrandt lighting with warm practical lamp light")
- **구도 1개**: 위 구도 레퍼런스에서 선택 (예: "rule of thirds composition", "frame within frame through doorway")
- **렌즈 1개**: 촬영 의도에 맞는 렌즈 (예: "shot on 35mm lens", "anamorphic lens flare")
- **카메라 시퀀스 2~3개**: temporal beats 안에 자연스럽게 포함
- **색보정 톤 1개**: (예: "teal and orange grade", "warm desaturated tone")
- **감독 시그니처**: ${directorNameKo}의 특징적 기법 1~2개
- **지역 특화**: ${region || "한국"} 특유의 연출 기법 적용 (위 지역 특화 연출 참조)
- **추상적 감정 금지**: "feeling sad" → "shoulders slumped, gaze downward" (물리적 표현으로 변환)
- **정확한 숫자 금지**: "three birds" → "a small flock of birds" (Veo는 정확한 수를 못 셈)

**캐릭터 일관성:**
- 모든 프롬프트에 캐릭터 전체 외형 묘사를 매번 100% 반복
- "same character" 등 참조 표현 절대 금지
- 의상, 헤어, 체형, 피부톤 불변

**시작/끝 프레임 이미지 (Start/End Frame — 핵심!):**
- imagePrompt = 장면의 **첫 프레임** (8초의 시작 순간)
- endImagePrompt = 장면의 **마지막 프레임** (8초의 끝 순간)
- 두 이미지는 같은 장면이지만 카메라 위치, 캐릭터 포즈, 조명이 8초 동안 변화한 결과
- **핵심 규칙: CUT N의 endImagePrompt ≈ CUT N+1의 imagePrompt**
  - CUT 1 끝: "캐릭터가 문을 여는 순간, 문 너머 빛이 쏟아지는 클로즈업"
  - CUT 2 시작: "문이 열리며 빛이 쏟아지는 역광, 캐릭터 실루엣이 문 앞에 서있는 와이드"
  - 같은 순간을 다른 앵글/스케일로 묘사하여 자연스러운 컷 전환
- endImagePrompt도 100% 영어, 캐릭터 외형 전체 반복, 조명/구도 포함
- 마지막 장면의 endImagePrompt는 이야기의 감정적 결말을 시각화

**Extend 프롬프트 (장면 연결 — 가장 중요!):**
- 장면 1: extendPrompt = ""
- 장면 2+: Veo Scene Extension API에서 사용됨. 이전 영상의 마지막 프레임부터 이어서 생성됨.
- **핵심**: extendPrompt는 "이전 장면의 마지막 순간 묘사 → 자연스러운 전환 → 새 장면" 3단계 구조로 작성
  - 1단계: 이전 장면 마지막 2초의 화면 상태를 구체적으로 묘사 (카메라 위치, 캐릭터 포즈, 조명)
  - 2단계: 전환 기법 명시 (예: "the camera pushes through the eye into", "match cut from X to Y", "whip pan reveals")
  - 3단계: 새 장면의 8초 동작 시퀀스
- 예시: CUT 1이 "눈 클로즈업으로 끝"이면 → CUT 2 extendPrompt: "Extreme close-up of the woman's eye fills the frame, [캐릭터 외형]. The camera pushes forward into the dark pupil — a match cut dissolves into an establishing wide shot of Edo-period Kyoto streets at dawn. [새 장면 8초 묘사]"
- "Continue from previous scene" 같은 모호한 표현 절대 금지
- 이전 장면의 마지막 시각 요소(색감, 구도, 캐릭터 위치)를 정확히 참조
- 캐릭터 전체 외형을 다시 100% 반복 기술
- **감독 스타일 유지**: "directed by ${directorName}" + 해당 감독의 시그니처 기법(조명, 색감, 구도)을 extendPrompt에도 반드시 포함

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
    "cameraDirection": "[영어] Lens: [렌즈mm]. Composition: [구도]. Camera: [앵글1]→[무빙1]→[앵글2]→[무빙2]→[앵글3]. ${directorNameKo} style.",
    "moodLighting": "[영어] [조명 기법 1~2개 구체 명시]. [색보정 톤]. [감독 스타일 조명]",
    "imagePrompt": "[100% ENGLISH — 첫 프레임] [WHO is doing WHAT, WHERE at the START of the 8-second clip]. [캐릭터 전체 외형]. [starting camera angle + composition]. [조명]. ${veoStyle}, ${regionFlavor}, directed by ${directorName}, cinematic quality, highly detailed, ${aspectRatio || "1:1"} aspect ratio, no text overlay, no titles, no captions, no watermark, no written characters, no calligraphy, no stamps, no logos",
    "endImagePrompt": "[100% ENGLISH — 끝 프레임] [WHO is doing WHAT, WHERE at the END of the 8-second clip — after camera movement and action]. [캐릭터 전체 외형]. [ending camera angle + composition]. [조명 변화]. ${veoStyle}, ${regionFlavor}, directed by ${directorName}, cinematic quality, highly detailed, ${aspectRatio || "1:1"} aspect ratio, no text overlay, no titles, no captions, no watermark, no written characters, no calligraphy, no stamps, no logos. NOTE: This end frame must visually connect to the NEXT cut's start frame.",
    "videoPrompt": "[100% ENGLISH] [Shot type], [camera movement]. [캐릭터 전체 외형]. 0s-2s: [establishing action + camera start position]. 2s-5s: [development + camera transition]. 5s-8s: [climax + final camera position]. [조명: e.g. warm key light from upper left, cool fill]. [색보정: e.g. teal and orange grade]. ${veoStyle}, Style: ${directorName}, shot on [렌즈], [구도], cinematic, film grain, shallow depth of field. No text, no watermark, no readable writing on screen",
    "extendPrompt": "[CUT 1만 빈 문자열. CUT 2+: 100% ENGLISH — temporal beats 필수] [Shot type], [camera]. [캐릭터 전체 외형]. 0s-2s: [transition from previous scene's last moment]. 2s-5s: [new scene develops, main action]. 5s-8s: [scene climax, camera settles]. [조명]. ${veoStyle}, directed by ${directorName}, ${regionFlavor}, cinematic, no text, no watermark, no readable writing",
    "transitionHint": "[한국어] 다음 장면 연결 방식",
    "characterConsistency": "[한국어] 캐릭터 유지 지침",
    "charactersInScene": ["char-1"]
  }]
}

JSON만 출력. 설명/마크다운 펜스/주석 없이.`;

    const result = await streamingGenerate(context.env, "gemini-3-pro-preview", {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 16384 },
    });

    if (result.error) {
      console.error("Gemini API error:", result.status, result.error);
      let detail = "";
      try {
        const errJson = JSON.parse(result.error);
        detail = errJson?.error?.message || result.error.slice(0, 200);
      } catch {
        detail = result.error.slice(0, 200);
      }
      return Response.json(
        { error: `Gemini API error: ${result.status}`, detail },
        { status: 502 },
      );
    }

    const text = result.text.trim() || "{}";

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
