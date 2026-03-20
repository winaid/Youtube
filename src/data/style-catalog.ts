/**
 * 계층형 영상 스타일 카탈로그
 *
 * 구조: StyleCategory (상위 7개) → StyleEntry (세부 스타일 ~50개)
 * 각 StyleEntry는 고유 id, 한국어 이름, 영문 프롬프트 프리셋(positive/negative)을 포함.
 *
 * 기존 AnimationMode 값은 legacyMode로 매핑 — 마이그레이션 호환.
 */

// ─── 타입 정의 ─────────────────────────────────────────────────────

/**
 * 스타일 전용 페르소나 — "어떤 미감으로 판단하고 어떤 결과를 실패로 보는지"
 * 프롬프트 생성 시 아트디렉터 역할로 주입됨
 */
export interface StylePersona {
  /** 페르소나 직함 (예: "수채화 애니메이션 아트디렉터") */
  title: string;
  /** 이 스타일의 미적 판단 기준 */
  aesthetic: string;
  /** 이 스타일에서 실패로 간주하는 결과 */
  failureCriteria: string;
  /** 품질 체크리스트 (anti-drift validation용) */
  qualityChecklist: string[];
}

/**
 * 스타일 렌더링 규칙 — 캐릭터/환경/모션/시퀀스 각각 전용
 */
export interface StyleRenderingRules {
  /** 캐릭터 렌더링 규칙 */
  characterRules: string;
  /** 환경/배경 렌더링 규칙 */
  environmentRules: string;
  /** 카메라 기본값 */
  cameraDefaults: string;
  /** 모션/움직임 기본값 */
  motionDefaults: string;
  /** 연속 장면 규칙 (컷 간 일관성) */
  sequenceRules: string;
}

export interface StyleEntry {
  /** 고유 식별자 (slug) — STYLE_PRESETS 키로도 사용 */
  id: string;
  /** UI 표시 이름 (한국어) */
  nameKo: string;
  /** 한 줄 설명 (한국어) */
  descKo: string;
  /** 카테고리 id 참조 */
  categoryId: string;
  /** 기존 AnimationMode 호환 — STYLE_PRESETS 룩업 키 (마이그레이션) */
  legacyMode?: string;
  /** 영상 모델에 전송하는 긍정 프롬프트 프리셋 */
  positivePrompt: string;
  /** 영상 모델에 전송하는 부정 프롬프트 프리셋 */
  negativePrompt: string;
  /** 추천 감독 이름 목록 (한국어) */
  directors: string[];
  /** 결과 성향 뱃지 */
  badge: string;
  /** 리얼리즘 수준 표시 */
  realism: "높음" | "중간" | "낮음";
}

export interface StyleCategory {
  id: string;
  nameKo: string;
  descKo: string;
  /** 카테고리 대표 색상 (hex) */
  color: string;
  styles: StyleEntry[];
}

// ─── 카탈로그 정의 ─────────────────────────────────────────────────

export const STYLE_CATALOG: StyleCategory[] = [
  // ═══════════════════════════════════════════════════════════════════
  // 1. 실사
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "live_action",
    nameKo: "실사",
    descKo: "카메라 기반, 포토리얼 영상",
    color: "#3b82f6",
    styles: [
      {
        id: "cinematic-realism",
        nameKo: "시네마틱 리얼리즘",
        descKo: "극장 필름급 시네마틱 실사",
        categoryId: "live_action",
        legacyMode: "실사",
        positivePrompt: "Photorealistic cinematic live-action. Natural lighting with dramatic shadows. Filmic depth of field with anamorphic lens characteristics. Real-world textures and materials. Professional color grading with rich contrast. Film grain subtle and organic.",
        negativePrompt: "cartoon, anime, illustration, painting, flat colors, cel-shading, stylized, text overlay, watermark",
        directors: ["봉준호", "크리스토퍼 놀란", "데이비드 핀처"],
        badge: "극장 실사",
        realism: "높음",
      },
      {
        id: "docu-handheld",
        nameKo: "다큐 핸드헬드",
        descKo: "다큐멘터리풍 핸드헬드 촬영",
        categoryId: "live_action",
        positivePrompt: "Documentary-style handheld footage. Natural available lighting, no artificial setup. Candid framing with observational distance. Shallow depth of field capturing real moments. Slightly desaturated natural color palette. Subtle camera shake adding authenticity.",
        negativePrompt: "cinematic color grading, studio lighting, perfect composition, stabilized smooth camera, anime, cartoon, text overlay, watermark",
        directors: ["시 슐레이머 닝", "프레드릭 와이즈만", "왕빙"],
        badge: "다큐멘터리",
        realism: "높음",
      },
      {
        id: "commercial-ad",
        nameKo: "광고 영상",
        descKo: "고급 광고/브랜드 영상 퀄리티",
        categoryId: "live_action",
        positivePrompt: "High-end commercial cinematography. Perfect studio lighting with soft diffusion. Ultra-clean composition with product-hero framing. Rich saturated colors with polished color grading. Smooth dolly and crane movements. Premium quality 4K sharpness throughout.",
        negativePrompt: "grainy, low quality, documentary style, shaky camera, desaturated, gritty, amateur lighting, text overlay, watermark",
        directors: ["리들리 스콧", "데이비드 핀처", "웨스 앤더슨"],
        badge: "프리미엄 광고",
        realism: "높음",
      },
      {
        id: "vintage-film",
        nameKo: "빈티지 필름",
        descKo: "70년대 필름 그레인, 바랜 색감",
        categoryId: "live_action",
        legacyMode: "빈티지 필름",
        positivePrompt: "Vintage 35mm film look. Warm film grain throughout. Faded analog color palette with light leaks. Soft focus edges and chromatic aberration. Chemical processing artifacts visible. Warm desaturated amber tones with natural vignetting.",
        negativePrompt: "digital clean modern look, oversaturated colors, perfect sharpness, HDR, text overlay, watermark",
        directors: ["쿼틴 타란티노", "왕가위", "알폰소 쿠아론"],
        badge: "아날로그 필름",
        realism: "높음",
      },
      {
        id: "neon-noir",
        nameKo: "네온 누아르",
        descKo: "네온빛 어둠, 비 젖은 도시",
        categoryId: "live_action",
        legacyMode: "네온 사이버펑크",
        positivePrompt: "Neon noir aesthetic. Dark atmosphere with vivid neon lights — pink, blue, purple, cyan. Wet reflective surfaces catching neon glow. Rain-slicked urban environments. Strong rim lighting with deep shadows. Semi-realistic figures with neon-lit faces.",
        negativePrompt: "natural daylight, muted colors, pastoral setting, bright clean look, text overlay, watermark",
        directors: ["니콜라스 빈딩 레픈", "드니 빌뇌브", "콘 사토시"],
        badge: "네온 강조",
        realism: "높음",
      },
      {
        id: "vhs-retro",
        nameKo: "VHS 레트로",
        descKo: "VHS 테이프 글리치, 스캔라인",
        categoryId: "live_action",
        positivePrompt: "VHS analog video aesthetic. Visible scan lines and tracking artifacts. Color bleeding and chromatic distortion. Warm oversaturated colors with magnetic tape noise. CRT screen glow effect. Low-resolution softness with interlacing artifacts. 4:3 aspect ratio feel.",
        negativePrompt: "digital clean, high resolution, 4K sharp, modern color grading, perfect image quality, text overlay, watermark",
        directors: ["데이비드 린치", "하모니 코린", "사프디 형제"],
        badge: "VHS 감성",
        realism: "높음",
      },
      {
        id: "sf-futuristic",
        nameKo: "SF 미래도시",
        descKo: "미래 도시, 홀로그램, 첨단 기술",
        categoryId: "live_action",
        positivePrompt: "Sci-fi futuristic city. Towering megastructures with holographic displays. Clean metallic and glass surfaces reflecting artificial light. Volumetric fog with neon accents. Advanced technology interfaces glowing softly. Flying vehicles in layered aerial traffic. Cinematic widescreen composition.",
        negativePrompt: "medieval, pastoral, rustic, natural landscape, historical setting, warm earth tones, text overlay, watermark",
        directors: ["드니 빌뇌브", "리들리 스콧", "알렉스 가랜드"],
        badge: "SF 미래",
        realism: "높음",
      },
      {
        id: "gothic-horror",
        nameKo: "고딕/호러",
        descKo: "어둡고 음울한 고딕 분위기",
        categoryId: "live_action",
        positivePrompt: "Gothic horror atmosphere. Deep shadows with minimal harsh light sources — candles, moonlight, lightning. Desaturated cold blue-grey palette with occasional warm accent. Fog and mist creeping through decayed architecture. Textured stone, rotting wood, tarnished metal. Unsettling camera angles — dutch tilt, extreme low angle.",
        negativePrompt: "bright lighting, warm colors, cheerful mood, modern setting, clean environment, cartoon, text overlay, watermark",
        directors: ["기예르모 델 토로", "로버트 에거스", "제임스 완"],
        badge: "고딕 공포",
        realism: "높음",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 2. 2D 애니메이션
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "animation_2d",
    nameKo: "2D 애니메이션",
    descKo: "셀 애니, 수채화, 잉크 드로잉 등 2D 기반",
    color: "#f43f5e",
    styles: [
      {
        id: "tv-anime",
        nameKo: "TV 애니",
        descKo: "일본 TV 애니메이션 스타일",
        categoryId: "animation_2d",
        legacyMode: "2D 애니",
        positivePrompt: "2D anime animation style. Cel-shaded illustration with clean outlines and vibrant flat colors. Anime character proportions with expressive features and large eyes. Illustrated backgrounds with painterly detail. Dynamic anime camera angles with speed lines.",
        negativePrompt: "3D rendering, realistic skin, real photography, cinematic realism, natural film grain, text overlay, watermark",
        directors: ["미야자키 하야오", "신카이 마코토", "콘 사토시"],
        badge: "TV 애니",
        realism: "낮음",
      },
      {
        id: "theatrical-anime",
        nameKo: "극장판 애니",
        descKo: "극장 퀄리티 고작화 애니메이션",
        categoryId: "animation_2d",
        positivePrompt: "Theatrical-quality anime. Extremely detailed hand-drawn animation with rich color depth. Lush painted backgrounds with cinematic lighting. Fluid character animation with high frame count. Dramatic camera work — sweeping dolly, dynamic tracking. Atmospheric depth with volumetric light particles.",
        negativePrompt: "TV-quality limited animation, flat background, simple shading, 3D CGI, photorealistic, text overlay, watermark",
        directors: ["미야자키 하야오", "신카이 마코토", "오시이 마모루"],
        badge: "극장판 작화",
        realism: "낮음",
      },
      {
        id: "storybook-anime",
        nameKo: "동화책 애니",
        descKo: "그림책 느낌의 부드러운 애니메이션",
        categoryId: "animation_2d",
        positivePrompt: "Storybook animation style. Soft pastel palette with gentle gradients. Picture-book illustration quality with round, friendly character designs. Warm diffused lighting with soft edges. Hand-colored appearance with subtle paper texture. Gentle flowing animation with fairy-tale atmosphere.",
        negativePrompt: "dark atmosphere, sharp anime outlines, realistic rendering, horror elements, violent imagery, text overlay, watermark",
        directors: ["미야자키 하야오", "이수진", "톰 무어"],
        badge: "동화 감성",
        realism: "낮음",
      },
      {
        id: "painted-2d",
        nameKo: "페인티드 2D",
        descKo: "유화/수채 터치의 회화적 애니",
        categoryId: "animation_2d",
        legacyMode: "수채화 애니",
        positivePrompt: "Fully painted animation — every frame is a hand-painted oil/watercolor painting in motion. Expressive visible brushwork on all surfaces. Characters, backgrounds, and lighting all rendered in living paint strokes that flow with movement. Thick impasto highlights, soft wet-on-wet blending, canvas grain visible throughout.",
        negativePrompt: "photorealistic rendering, static illustration, digital clean rendering, flat vector art, text overlay, watermark",
        directors: ["미야자키 하야오", "도로시아 랜싱", "임권택"],
        badge: "회화 애니",
        realism: "낮음",
      },
      {
        id: "watercolor-animation",
        nameKo: "수채화 애니메이션",
        descKo: "번지는 수채 물감, 투명한 색층",
        categoryId: "animation_2d",
        positivePrompt: "Watercolor animation. Transparent color washes flowing and bleeding into each other. Visible wet-on-wet paint spreading. White paper showing through translucent layers. Soft undefined edges where colors meet. Delicate pastel tones with occasional vibrant accents. Light captured through paint transparency.",
        negativePrompt: "opaque solid colors, cel-shading, sharp outlines, digital rendering, photorealistic, heavy dark palette, text overlay, watermark",
        directors: ["미야자키 하야오", "알렉산드르 페트로프"],
        badge: "수채 질감",
        realism: "낮음",
      },
      {
        id: "ink-drawing-anime",
        nameKo: "잉크 드로잉 애니",
        descKo: "펜과 잉크 라인 아트 애니메이션",
        categoryId: "animation_2d",
        positivePrompt: "Ink line drawing animation. Bold expressive pen strokes with varying line weight. Cross-hatching for shadows and depth. Black ink on white paper with occasional ink wash shading. Architectural precision in environments, expressive looseness in characters. Visible pen texture and occasional ink splatter.",
        negativePrompt: "full color, painted, cel-shaded, photorealistic, 3D rendering, smooth digital, text overlay, watermark",
        directors: ["오토모 가츠히로", "콘 사토시"],
        badge: "잉크 라인",
        realism: "낮음",
      },
      {
        id: "webtoon-motion",
        nameKo: "웹툰 모션",
        descKo: "한국 웹툰풍 모션 코믹",
        categoryId: "animation_2d",
        positivePrompt: "Korean webtoon motion comic style. Clean digital line art with solid flat coloring. Dramatic panel-to-panel transitions with motion parallax. Character designs with manhwa proportions — sharp jawlines, detailed eyes. Vivid color palette with strong shadows. Speed lines and impact frames for action. Vertical scroll composition influence.",
        negativePrompt: "Japanese anime style, watercolor, hand-drawn roughness, 3D CGI, photorealistic, text overlay, watermark",
        directors: ["연상호", "박인제"],
        badge: "웹툰풍",
        realism: "낮음",
      },
      {
        id: "cutout-anime",
        nameKo: "컷아웃 애니",
        descKo: "종이 오려붙이기 느낌의 2D 애니",
        categoryId: "animation_2d",
        positivePrompt: "Paper cutout animation. Flat paper shapes with visible cut edges and layered depth. Hinged joint movement on character limbs. Subtle paper shadow between layers creating parallax depth. Textured paper surfaces — kraft, cardstock, tissue paper. Simple geometric shapes with craft aesthetic.",
        negativePrompt: "3D depth, photorealistic, smooth animation, film grain, cel-shaded, natural movement, text overlay, watermark",
        directors: ["미셸 오슬로", "이리 트른카"],
        badge: "컷아웃 공예",
        realism: "낮음",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 3. 3D 애니메이션
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "animation_3d",
    nameKo: "3D 애니메이션",
    descKo: "CGI 기반 3D 렌더링 스타일",
    color: "#8b5cf6",
    styles: [
      {
        id: "pixar-style",
        nameKo: "픽사풍",
        descKo: "픽사/디즈니 스타일 3D 애니메이션",
        categoryId: "animation_3d",
        positivePrompt: "Pixar-style 3D animation. Smooth subsurface scattering on skin. Expressive stylized character designs with round appealing proportions. Rich global illumination with warm color palette. Detailed textured environments with cinematic depth of field. Subtle ambient occlusion and soft shadows.",
        negativePrompt: "photorealistic, flat 2D, anime, uncanny valley, low poly, hard edges, dark horror atmosphere, text overlay, watermark",
        directors: ["피트 닥터", "브래드 버드", "앤드류 스탠턴"],
        badge: "픽사 3D",
        realism: "중간",
      },
      {
        id: "dreamworks-style",
        nameKo: "드림웍스풍",
        descKo: "드림웍스 스타일 역동적 3D",
        categoryId: "animation_3d",
        positivePrompt: "DreamWorks-style 3D animation. Bold exaggerated character proportions with sharp angular features. Dynamic action-oriented poses and expressions. Saturated vivid color palette with dramatic lighting contrast. Detailed hair and fur simulation. Energetic camera movement with dramatic angles.",
        negativePrompt: "photorealistic, flat 2D, subdued colors, static poses, horror, uncanny valley, text overlay, watermark",
        directors: ["콘래드 버논", "딘 데블로이스"],
        badge: "드림웍스 3D",
        realism: "중간",
      },
      {
        id: "stylized-3d",
        nameKo: "스타일라이즈드 3D",
        descKo: "카툰 렌더링 3D, 셀셰이딩 3D",
        categoryId: "animation_3d",
        positivePrompt: "Stylized 3D animation with toon shading. Bold outlines over 3D geometry. Flat color zones with sharp shadow edges — cel-shaded look rendered in 3D. Exaggerated proportions and expressive poses. Clean simplified surfaces without realistic texture detail. Vibrant cartoon color palette.",
        negativePrompt: "photorealistic rendering, subsurface scattering, realistic skin, film grain, 2D hand-drawn, text overlay, watermark",
        directors: ["미야자키 하야오", "닌텐도"],
        badge: "카툰 3D",
        realism: "낮음",
      },
      {
        id: "semi-real-3d",
        nameKo: "세미리얼 3D",
        descKo: "반실사 3D 렌더링",
        categoryId: "animation_3d",
        legacyMode: "하이브리드",
        positivePrompt: "Semi-realistic 3D animation. Anime-influenced character proportions within detailed realistic environments. Photorealistic background rendering with stylized character design. Cinematic lighting with ray-traced reflections. Smooth digital camera motion. High-quality PBR materials on environments.",
        negativePrompt: "pure photorealism, pure flat anime, uncanny valley, text overlay, watermark",
        directors: ["이안", "기예르모 델 토로", "제임스 카메론"],
        badge: "반실사 3D",
        realism: "중간",
      },
      {
        id: "low-poly-3d",
        nameKo: "로우폴리 3D",
        descKo: "저폴리곤 미니멀 3D",
        categoryId: "animation_3d",
        positivePrompt: "Low-poly 3D art style. Visible geometric facets on all surfaces. Flat shading with minimal texture — color comes from material, not maps. Clean geometric character and environment design. Soft pastel or bold primary color palette. Isometric or gentle perspective camera. Peaceful minimalist aesthetic.",
        negativePrompt: "high-poly detail, realistic textures, film grain, photorealistic, complex organic shapes, text overlay, watermark",
        directors: ["팀 셰이퍼"],
        badge: "로우폴리",
        realism: "낮음",
      },
      {
        id: "miniature-3d",
        nameKo: "미니어처 3D",
        descKo: "틸트시프트 미니어처 디오라마",
        categoryId: "animation_3d",
        legacyMode: "미니어처",
        positivePrompt: "Tilt-shift miniature effect. Extreme shallow depth of field making everything appear diorama-scale. Toy-like proportions with slightly saturated coloring. Bright overhead lighting on miniature sets. Everything appears like a detailed miniature model. Top-down or slight overhead camera angle.",
        negativePrompt: "normal human scale, deep focus, realistic proportions, text overlay, watermark",
        directors: ["웨스 앤더슨", "피터 잭슨"],
        badge: "미니어처 3D",
        realism: "중간",
      },
      {
        id: "game-cinematic-3d",
        nameKo: "게임 시네마틱 3D",
        descKo: "AAA 게임 시네마틱 트레일러 퀄리티",
        categoryId: "animation_3d",
        positivePrompt: "AAA game cinematic quality 3D rendering. Unreal Engine 5 level detail with nanite geometry. Ray-traced global illumination and reflections. High-fidelity character models with detailed skin shading. Epic dramatic camera choreography. Atmospheric volumetric fog and particle effects. Heroic dramatic lighting.",
        negativePrompt: "low poly, cartoon, flat shading, 2D anime, watercolor, hand-drawn, text overlay, watermark",
        directors: ["닐 드럭만", "히데오 코지마"],
        badge: "게임 시네마틱",
        realism: "높음",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 4. 회화/일러스트
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "painting",
    nameKo: "회화/일러스트",
    descKo: "전통 미술 기법 기반 스타일",
    color: "#f59e0b",
    styles: [
      {
        id: "watercolor",
        nameKo: "수채화",
        descKo: "투명 수채 물감의 번지는 질감",
        categoryId: "painting",
        positivePrompt: "Watercolor painting style. Transparent paint washes with visible water bleeding. White paper texture showing through translucent layers. Soft edges where wet paint meets wet paint. Delicate light captured through paint transparency. Gentle palette with occasional bold color accents.",
        negativePrompt: "opaque paint, thick impasto, digital rendering, photorealistic, sharp outlines, text overlay, watermark",
        directors: ["미야자키 하야오"],
        badge: "수채화",
        realism: "낮음",
      },
      {
        id: "oil-painting",
        nameKo: "유화",
        descKo: "두꺼운 유화 물감, 임파스토 질감",
        categoryId: "painting",
        positivePrompt: "Oil painting style with thick impasto brushwork. Visible palette knife and brush texture on all surfaces. Rich opaque color mixing on canvas. Dramatic chiaroscuro lighting with deep shadows and bright highlights. Layered paint building dimensional texture. Classical painting composition and color harmony.",
        negativePrompt: "flat digital, clean vector, watercolor transparency, photorealistic, anime cel-shading, text overlay, watermark",
        directors: ["알렉산드르 페트로프", "피터 그리너웨이"],
        badge: "유화 질감",
        realism: "낮음",
      },
      {
        id: "gouache",
        nameKo: "구아슈",
        descKo: "불투명 수채, 매트한 색면",
        categoryId: "painting",
        positivePrompt: "Gouache painting style. Opaque matte color layers with subtle brush texture. Flat color areas with soft blending at edges. Rich saturated matte palette without glossy highlights. Visible brushwork direction adding subtle texture. Illustrative composition with clear foreground-background separation.",
        negativePrompt: "glossy finish, transparent watercolor, photorealistic, digital clean, thick impasto, text overlay, watermark",
        directors: ["메리 블레어", "에릭 칼"],
        badge: "구아슈 매트",
        realism: "낮음",
      },
      {
        id: "pastel",
        nameKo: "파스텔",
        descKo: "부드러운 파스텔 크레용 질감",
        categoryId: "painting",
        positivePrompt: "Pastel crayon art style. Soft chalky texture on textured paper. Gentle blending with visible grain of pastel medium. Warm diffused color with soft edges. Dreamy atmospheric quality with pastel dust haze. Muted palette with gentle color transitions. Paper tooth visible through pigment.",
        negativePrompt: "sharp edges, vivid saturated colors, digital clean, photorealistic, ink lines, hard contrast, text overlay, watermark",
        directors: ["에드가 드가", "오딜롱 르동"],
        badge: "파스텔 톤",
        realism: "낮음",
      },
      {
        id: "east-asian-painting",
        nameKo: "동양화풍 2D",
        descKo: "동양화 화풍의 2D 애니메이션 — 정적 그림이 아닌 살아 움직이는 애니 시퀀스",
        categoryId: "painting",
        positivePrompt: "2D animated sequence in East Asian painting-inspired art style. Brush-and-ink influenced rendering with hand-painted look. Muted mineral pigment color palette with ink wash gradients. Soft brushstroke textures on characters and backgrounds. Rice paper or hanji surface hint. Atmospheric perspective with misty layered depth. Animated character movement with fluid 2D motion. Non-photorealistic painterly 2D animation. Stylized animated action, not static artwork.",
        negativePrompt: "static painting, scroll painting, art plate display, storybook page, motion poster, barely moving still image, photorealistic, 3D rendering, text, letters, labels, calligraphy, Chinese characters, Korean characters, Japanese characters, typographic marks, readable symbols, text overlay, watermark, captions",
        directors: ["임권택", "장이머우", "첸 카이거"],
        badge: "동양화풍 애니",
        realism: "낮음",
      },
      {
        id: "ink-wash",
        nameKo: "수묵풍 2D",
        descKo: "수묵 화풍의 2D 애니메이션 — 먹선과 담채 느낌의 움직이는 시퀀스",
        categoryId: "painting",
        legacyMode: "잉크워시",
        positivePrompt: "2D animated sequence in sumi-e ink wash art style. Monochrome ink gradients with brush-and-ink rendering. Varying ink density and deliberate white space as design element. Animated fluid brush movement with hand-painted 2D motion. Rice paper texture hint. Non-photorealistic painterly animation. Stylized animated characters and environments, not static artwork. Dynamic 2D scene with clear motion and progression.",
        negativePrompt: "static painting, scroll display, art plate, storybook page, motion poster, barely moving image, vibrant colorful palette, digital clean rendering, photorealistic, 3D CGI, flat anime colors, text, letters, labels, calligraphy, Chinese characters, Korean characters, Japanese characters, typographic marks, readable symbols, text overlay, watermark, captions",
        directors: ["장이머우", "임권택", "아피찻퐁"],
        badge: "수묵풍 애니",
        realism: "낮음",
      },
      {
        id: "inkwash-painting",
        nameKo: "잉크 워시",
        descKo: "서양식 잉크 워시 페인팅",
        categoryId: "painting",
        positivePrompt: "Western ink wash painting style. Fluid black ink diluted to various grey tones. Expressive wet brush strokes on heavy watercolor paper. Dramatic contrast between dense black and diluted washes. Loose gestural marks suggesting form rather than defining it. Atmospheric and moody with abstract qualities.",
        negativePrompt: "sharp outlines, full color, digital rendering, photorealistic, anime, cel-shading, text overlay, watermark",
        directors: ["빅토르 에리세", "안드레이 타르코프스키"],
        badge: "잉크 워시",
        realism: "낮음",
      },
      {
        id: "van-gogh-painted",
        nameKo: "고흐풍 페인티드",
        descKo: "소용돌이치는 별밤 스타일 붓터치",
        categoryId: "painting",
        positivePrompt: "Van Gogh post-impressionist style. Swirling energetic brushstrokes with thick impasto texture. Vivid complementary color contrasts — deep blues against bright yellows. Visible directional brushwork creating movement and energy. Expressive color choices over realistic representation. Starry night-inspired dynamic skies and landscapes.",
        negativePrompt: "flat colors, clean digital, photorealistic, smooth rendering, muted palette, static composition, text overlay, watermark",
        directors: ["도로타 코비엘라", "알렉산드르 페트로프"],
        badge: "고흐 터치",
        realism: "낮음",
      },
      {
        id: "editorial-illustration",
        nameKo: "에디토리얼 일러스트",
        descKo: "잡지/출판 일러스트레이션",
        categoryId: "painting",
        positivePrompt: "Editorial illustration style. Bold graphic compositions with strong silhouettes. Limited but impactful color palette — 3-4 key colors. Conceptual visual metaphors. Clean shapes with textured fills. Mix of flat color areas and detailed focal points. Magazine-quality design sensibility.",
        negativePrompt: "photorealistic, anime, full color spectrum, 3D rendering, film grain, complex detail everywhere, text overlay, watermark",
        directors: ["사울 바스", "크리스 웨어"],
        badge: "에디토리얼",
        realism: "낮음",
      },
      {
        id: "storybook-illustration",
        nameKo: "동화책 일러스트",
        descKo: "어린이 그림책 일러스트레이션",
        categoryId: "painting",
        positivePrompt: "Children's storybook illustration. Warm gentle color palette with soft watercolor or gouache textures. Whimsical character designs with round friendly proportions. Detailed miniature world-building in backgrounds. Gentle lighting with no harsh shadows. Hand-crafted quality with visible artistic medium. Magical atmosphere.",
        negativePrompt: "dark horror, realistic violence, photorealistic, sharp anime, industrial, dystopian, text overlay, watermark",
        directors: ["톰 무어", "미셸 오슬로"],
        badge: "동화 일러스트",
        realism: "낮음",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 5. 스톱모션/공예
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "stop_motion",
    nameKo: "스톱모션/공예",
    descKo: "수공예 소재, 프레임별 촬영",
    color: "#10b981",
    styles: [
      {
        id: "claymation",
        nameKo: "클레이메이션",
        descKo: "점토 캐릭터, 손자국 질감",
        categoryId: "stop_motion",
        legacyMode: "클레이",
        positivePrompt: "Claymation animation with smooth clay figures. Fingerprint texture on surfaces. Warm studio lighting on sculptural forms. Material imperfections visible — clay joins, subtle fingermarks. Stop-motion frame-by-frame jitter. Handmade sculptural quality throughout.",
        negativePrompt: "digital rendering, smooth CGI, photorealistic, shiny plastic, flat 2D, text overlay, watermark",
        directors: ["닉 파크", "웨스 앤더슨"],
        badge: "점토 질감",
        realism: "중간",
      },
      {
        id: "paper-collage",
        nameKo: "종이 콜라주",
        descKo: "오려붙인 종이 레이어 콜라주",
        categoryId: "stop_motion",
        positivePrompt: "Paper collage stop-motion. Cut paper layers with visible scissors-cut edges. Textured paper — newspaper, kraft, magazine clippings — combined into layered scenes. Subtle shadow between paper layers creating depth. Hinged paper joints for character movement. Handmade craft quality with visible glue and tape marks.",
        negativePrompt: "smooth digital, 3D CGI, photorealistic, clean vector art, anime, natural movement, text overlay, watermark",
        directors: ["테리 길리엄", "미셸 공드리"],
        badge: "종이 콜라주",
        realism: "낮음",
      },
      {
        id: "felt-craft",
        nameKo: "펠트 공예",
        descKo: "펠트 원단으로 만든 캐릭터/배경",
        categoryId: "stop_motion",
        positivePrompt: "Felt craft stop-motion. Soft felt fabric texture on all characters and environments. Visible stitching and fabric seams. Warm fuzzy material quality with slight fiber fuzz on edges. Button eyes and embroidered details. Cozy handmade aesthetic with warm studio lighting.",
        negativePrompt: "hard surfaces, metallic, digital rendering, photorealistic, anime, sharp edges, text overlay, watermark",
        directors: ["웨스 앤더슨"],
        badge: "펠트 공예",
        realism: "중간",
      },
      {
        id: "wooden-puppet",
        nameKo: "목각 인형",
        descKo: "나무 마리오네트/인형극 느낌",
        categoryId: "stop_motion",
        positivePrompt: "Wooden puppet stop-motion. Carved wooden characters with visible wood grain and jointed limbs. Marionette-like movement with string puppet articulation. Warm wood tones — oak, walnut, birch. Miniature wooden stage sets with painted backdrops. Warm theatrical lighting. Handcrafted folk-art quality.",
        negativePrompt: "flexible realistic movement, digital rendering, smooth CGI, anime, photorealistic skin, text overlay, watermark",
        directors: ["이리 트른카", "웨스 앤더슨"],
        badge: "목각 인형",
        realism: "중간",
      },
      {
        id: "paper-puppet",
        nameKo: "종이 인형극",
        descKo: "그림자극/종이 인형 애니메이션",
        categoryId: "stop_motion",
        positivePrompt: "Paper puppet shadow theater animation. Silhouette characters against backlit translucent screen. Intricate paper-cut details visible in shadow. Layered paper creating depth planes. Warm amber backlight creating dramatic silhouettes. Traditional shadow puppet articulated joints. Ornate decorative border elements.",
        negativePrompt: "full color, 3D rendering, photorealistic, daylight scene, anime, modern digital, text overlay, watermark",
        directors: ["로테 라이니거", "미셸 오슬로"],
        badge: "그림자극",
        realism: "낮음",
      },
      {
        id: "miniature-diorama",
        nameKo: "미니어처 디오라마",
        descKo: "정교한 미니어처 세트 촬영",
        categoryId: "stop_motion",
        legacyMode: "스톱모션",
        positivePrompt: "Stop-motion animation with handcrafted miniature textures. Frame-by-frame movement with stop-motion jitter. Tactile material surfaces — clay, fabric, felt, wood. Warm studio lighting on miniature sets. Miniature diorama environments with visible craft construction. Material imperfections present.",
        negativePrompt: "smooth CGI, digital clean rendering, plastic toy look, photorealistic, flat 2D animation, text overlay, watermark",
        directors: ["웨스 앤더슨", "기예르모 델 토로", "라이카 스튜디오"],
        badge: "수공예 디오라마",
        realism: "중간",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 6. 레트로/게임풍
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "retro_game",
    nameKo: "레트로/게임풍",
    descKo: "픽셀아트, 복고 게임 스타일",
    color: "#06b6d4",
    styles: [
      {
        id: "pixel-art",
        nameKo: "픽셀아트",
        descKo: "16비트 레트로 게임 픽셀",
        categoryId: "retro_game",
        legacyMode: "픽셀아트",
        positivePrompt: "Pixel art 16-bit retro animation. Crisp hard pixel edges with no anti-aliasing. Limited color palette. Blocky character sprites on pixel art backgrounds. Retro game aesthetic with dithered gradients.",
        negativePrompt: "smooth rendering, anti-aliased edges, 3D, photorealistic, high-resolution detail, text overlay, watermark",
        directors: ["쿼틴 타란티노", "콘 사토시"],
        badge: "16비트 픽셀",
        realism: "낮음",
      },
      {
        id: "16bit-jrpg",
        nameKo: "16비트 JRPG",
        descKo: "슈퍼패미컴 시대 JRPG 스타일",
        categoryId: "retro_game",
        positivePrompt: "16-bit JRPG pixel art style. Super Nintendo era top-down or side-view composition. Rich detailed pixel backgrounds with parallax scrolling. Chibi character sprites with exaggerated proportions. Limited 256-color palette with careful dithering. RPG UI elements — text boxes, health bars. Nostalgic warm color grading.",
        negativePrompt: "3D rendering, high resolution, smooth animation, photorealistic, modern graphics, text overlay, watermark",
        directors: ["사카구치 히로노부", "호리이 유지"],
        badge: "SNES JRPG",
        realism: "낮음",
      },
      {
        id: "8bit-arcade",
        nameKo: "8비트 아케이드",
        descKo: "NES/패미컴 시대 도트 그래픽",
        categoryId: "retro_game",
        positivePrompt: "8-bit NES/Famicom era pixel graphics. Extremely limited color palette — maximum 4 colors per sprite. Chunky large pixels with visible grid. Simple geometric character shapes. Black background with bright primary colors. Single-screen compositions. Arcade game aesthetic with score display area.",
        negativePrompt: "high resolution, detailed textures, 3D, smooth gradients, realistic lighting, modern graphics, text overlay, watermark",
        directors: ["미야모토 시게루"],
        badge: "8비트 NES",
        realism: "낮음",
      },
      {
        id: "ps1-lowpoly",
        nameKo: "PS1 로우폴리",
        descKo: "플레이스테이션 1 시대 3D 그래픽",
        categoryId: "retro_game",
        positivePrompt: "PlayStation 1 era low-poly 3D graphics. Visible polygon edges with warped texture mapping. Affine texture distortion and vertex snapping. Limited texture resolution with pixelated surfaces. Fog distance rendering hiding draw distance. Fixed camera angles. Muted lighting with strong colored light sources. Nostalgic early 3D game aesthetic.",
        negativePrompt: "high-poly detail, ray tracing, smooth textures, modern graphics, photorealistic, 2D pixel art, text overlay, watermark",
        directors: ["히데오 코지마", "유지 나카"],
        badge: "PS1 로우폴리",
        realism: "낮음",
      },
      {
        id: "90s-game-cutscene",
        nameKo: "90년대 게임 컷신",
        descKo: "90년대 FMV/CG 인트로 느낌",
        categoryId: "retro_game",
        positivePrompt: "90s pre-rendered CG cutscene style. Early computer graphics with Gouraud shading. Dramatic camera rotations around simple geometry. Metallic and chrome reflective surfaces. Lens flare effects and star-burst highlights. Low-polygon characters with pre-rendered backgrounds. Dramatic orchestral energy conveyed through lighting.",
        negativePrompt: "modern ray tracing, photorealistic, 2D anime, hand-drawn, pixel art, natural lighting, text overlay, watermark",
        directors: ["히데오 코지마", "노무라 테츠야"],
        badge: "90년대 CG",
        realism: "낮음",
      },
      {
        id: "visual-novel",
        nameKo: "비주얼 노벨풍",
        descKo: "일본 비주얼 노벨 게임 스타일",
        categoryId: "retro_game",
        positivePrompt: "Visual novel game style. Static or subtly animated character portraits on illustrated backgrounds. Clean anime-style character art with detailed face expressions. Soft background illustration with depth blur. Character positioned in lower-third or center frame. Ambient lighting with mood-dependent color temperature. Gentle particle effects — cherry blossoms, snow, light dust.",
        negativePrompt: "full 3D, photorealistic, pixel art, action animation, hand-drawn roughness, film grain, text overlay, watermark",
        directors: ["나스 키노코", "KEY"],
        badge: "비주얼 노벨",
        realism: "낮음",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 7. 실험/하이브리드
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "experimental",
    nameKo: "실험/하이브리드",
    descKo: "기법 혼합, 실험적 영상 스타일",
    color: "#ec4899",
    styles: [
      {
        id: "rotoscoping",
        nameKo: "로토스코핑",
        descKo: "실제 움직임 기반 2D 오버레이",
        categoryId: "experimental",
        legacyMode: "로토스코핑",
        positivePrompt: "Rotoscoped 2D animation. Performance-derived fluid movement with painterly stylized overlay. Hand-traced outlines over realistic motion. Artistic painted processing over every frame. Organic handheld documentary feel with artistic enhancement.",
        negativePrompt: "flat cartoon, generic anime, vibrant cel-shading, clean digital outlines, mechanical stiff movement, text overlay, watermark",
        directors: ["리처드 링클레이터", "콘 사토시", "아리 폴만"],
        badge: "로토스코핑",
        realism: "중간",
      },
      {
        id: "mixed-media-collage",
        nameKo: "믹스드 미디어 콜라주",
        descKo: "사진+그림+텍스처 혼합 콜라주",
        categoryId: "experimental",
        positivePrompt: "Mixed media collage animation. Layered combination of photography, illustration, fabric texture, and printed material. Cut-and-paste aesthetic with visible edge seams between media. Found footage and archival imagery mixed with hand-drawn elements. Textural variety — paper grain, fabric weave, photographic gloss. Experimental composition breaking traditional framing.",
        negativePrompt: "uniform single style, clean digital, photorealistic only, pure anime, consistent smooth rendering, text overlay, watermark",
        directors: ["테리 길리엄", "미셸 공드리", "찰리 카우프만"],
        badge: "믹스드 미디어",
        realism: "중간",
      },
      {
        id: "live-paint-overlay",
        nameKo: "실사 + 페인트 오버레이",
        descKo: "실사 영상 위에 페인트/드로잉 합성",
        categoryId: "experimental",
        positivePrompt: "Live-action footage with hand-painted overlay. Real photographic base visible beneath artistic paint strokes. Animated brush marks moving over filmed scenes. Color washes and ink splashes reacting to on-screen movement. Dual reality — photography and painting coexisting in same frame. Brushwork follows action, emphasizing emotion and movement.",
        negativePrompt: "pure photorealistic, pure painting only, clean digital composite, anime, 3D CGI, text overlay, watermark",
        directors: ["미셸 공드리", "피터 그리너웨이"],
        badge: "실사+페인트",
        realism: "중간",
      },
      {
        id: "docu-illustrated",
        nameKo: "다큐 + 일러스트 오버레이",
        descKo: "다큐멘터리 영상 위에 인포그래픽/일러스트",
        categoryId: "experimental",
        positivePrompt: "Documentary footage with animated illustrated overlay. Real-world documentary footage as base layer. Animated line drawings, diagrams, and infographic elements floating over live footage. Hand-drawn annotations highlighting real-world elements. Illustrated characters interacting with real environments. Educational yet artistic visual storytelling.",
        negativePrompt: "pure fiction, fantasy elements, pure animation only, pure live action only, text overlay, watermark",
        directors: ["아리 폴만", "키스 허링"],
        badge: "다큐+일러스트",
        realism: "중간",
      },
      {
        id: "2d-3d-hybrid",
        nameKo: "2D/3D 하이브리드",
        descKo: "2D 캐릭터 + 3D 배경 합성",
        categoryId: "experimental",
        positivePrompt: "2D-3D hybrid animation. Hand-drawn 2D animated characters moving within photorealistic or detailed 3D environments. Clear visual distinction between character and environment rendering. 2D characters with anime-influenced design on 3D rendered backgrounds. Cinematic camera movement through 3D space while characters remain 2D-styled.",
        negativePrompt: "uniform single rendering style, pure 2D, pure 3D, pure photorealistic, text overlay, watermark",
        directors: ["세르히오 파블로스", "히로유키 오쿠우라"],
        badge: "2D+3D 혼합",
        realism: "중간",
      },
      {
        id: "surreal-composite",
        nameKo: "초현실 합성",
        descKo: "초현실주의 비주얼, 꿈과 현실 혼합",
        categoryId: "experimental",
        positivePrompt: "Surreal composite visual style. Dream-logic spatial composition — impossible architecture, gravity-defying objects. Multiple realities overlapping in single frame. Scale distortion — giant objects in miniature spaces, tiny figures in vast landscapes. Melting, morphing, transforming elements. Rich symbolic imagery. Unexpected juxtapositions creating unease and wonder.",
        negativePrompt: "logical consistent physics, normal proportions, everyday realism, conventional composition, text overlay, watermark",
        directors: ["데이비드 린치", "찰리 카우프만", "루이스 부뉴엘"],
        badge: "초현실",
        realism: "중간",
      },
    ],
  },
];

// ─── 유틸리티 ─────────────────────────────────────────────────────

/** 모든 스타일을 플랫 배열로 반환 */
export function getAllStyles(): StyleEntry[] {
  return STYLE_CATALOG.flatMap((cat) => cat.styles);
}

/** id로 스타일 조회 */
export function getStyleById(id: string): StyleEntry | undefined {
  return getAllStyles().find((s) => s.id === id);
}

/** id로 카테고리 조회 */
export function getCategoryById(id: string): StyleCategory | undefined {
  return STYLE_CATALOG.find((c) => c.id === id);
}

/** 기존 legacyMode 값으로 새 스타일 id 조회 */
export function getStyleByLegacyMode(legacyMode: string): StyleEntry | undefined {
  return getAllStyles().find((s) => s.legacyMode === legacyMode);
}

/** 모든 스타일 id 목록 (AnimationMode 유니온 대체) */
export function getAllStyleIds(): string[] {
  return getAllStyles().map((s) => s.id);
}

// ═══════════════════════════════════════════════════════════════════
// 스타일 전용 페르소나 + 렌더링 규칙 시스템
// ═══════════════════════════════════════════════════════════════════
//
// 스타일 고정 10축 구조:
// 1. style preset (positivePrompt / negativePrompt — 위 StyleEntry에 정의)
// 2. style-specific persona (아래 STYLE_PERSONAS에 정의)
// 3. positive style rules (positivePrompt에서 파생)
// 4. negative style rules (negativePrompt에서 파생)
// 5. camera defaults (아래 STYLE_RENDERING_RULES에 정의)
// 6. motion defaults (아래 STYLE_RENDERING_RULES에 정의)
// 7. character rendering rules (아래 STYLE_RENDERING_RULES에 정의)
// 8. environment rendering rules (아래 STYLE_RENDERING_RULES에 정의)
// 9. sequence rules (아래 STYLE_RENDERING_RULES에 정의)
// 10. anti-drift validation (아래 StylePersona.qualityChecklist에 정의)
// ═══════════════════════════════════════════════════════════════════

/** 스타일 전용 페르소나 — 아트디렉터 역할 */
const STYLE_PERSONAS: Record<string, StylePersona> = {
  // ─── 실사 계열 ────────────────────────────────────────
  "cinematic-realism": {
    title: "시네마틱 리얼리즘 촬영감독",
    aesthetic: "프레임 안의 모든 것이 실제 카메라로 촬영된 것처럼 느껴져야 한다. 자연 조명, 진짜 소재 질감, 인간 피부의 미세한 결이 보여야 한다.",
    failureCriteria: "만화적 외곽선, 평면적 색감, CG 냄새가 나는 플라스틱 피부, 과도한 HDR, 일러스트 느낌이 조금이라도 보이면 실패.",
    qualityChecklist: [
      "피부에 자연스러운 모공/결이 있는가",
      "조명이 물리적으로 합리적인가 (광원 방향 일치)",
      "의상에 실제 원단 물리가 적용되었는가",
      "배경이 실제 촬영 장소처럼 보이는가",
      "카메라 렌즈 특성 (보케, 수차)이 있는가",
    ],
  },
  "docu-handheld": {
    title: "다큐멘터리 촬영감독",
    aesthetic: "관찰자 시점의 솔직한 카메라. 세팅된 조명이 아닌 자연광, 완벽하지 않은 구도가 핵심. 진실성이 미학이다.",
    failureCriteria: "스튜디오 조명, 완벽한 구도, 안정적인 짐벌 카메라, 영화적 색보정이 보이면 실패.",
    qualityChecklist: [
      "카메라 흔들림이 자연스럽게 있는가",
      "조명이 자연광/기존광만 사용하는가",
      "구도가 의도적으로 '불완전'한가",
      "피사체와 관찰 거리가 유지되는가",
    ],
  },
  "commercial-ad": {
    title: "프리미엄 광고 촬영감독",
    aesthetic: "모든 프레임이 잡지 화보처럼 완벽해야 한다. 조명, 구도, 색감 모두 계산된 프리미엄 품질.",
    failureCriteria: "거친 그레인, 불안정한 카메라, 탈색된 색감, 아마추어 조명이 보이면 실패.",
    qualityChecklist: [
      "조명이 스튜디오급으로 깨끗한가",
      "색감이 풍부하고 일관적인가",
      "구도가 계산되어 있는가",
      "전체적인 '프리미엄 느낌'이 있는가",
    ],
  },
  "vintage-film": {
    title: "아날로그 필름 색보정 전문가",
    aesthetic: "35mm 필름을 현상실에서 처리한 것처럼 보여야 한다. 빛 번짐, 필름 그레인, 바랜 색감이 핵심.",
    failureCriteria: "디지털적으로 깨끗한 이미지, 과도한 채도, 완벽한 선명도가 보이면 실패.",
    qualityChecklist: [
      "필름 그레인이 전체적으로 있는가",
      "색이 자연스럽게 바래 있는가",
      "빛 번짐/라이트 리크가 있는가",
      "소프트 포커스 가장자리가 있는가",
    ],
  },
  "neon-noir": {
    title: "네온 누아르 촬영감독",
    aesthetic: "어둠 속에서 네온빛만이 유일한 조명. 젖은 노면 반사, 림라이트, 깊은 그림자가 필수.",
    failureCriteria: "자연 주광, 따뜻한 색감, 밝고 깨끗한 환경, 파스텔 톤이 보이면 실패.",
    qualityChecklist: [
      "화면의 70% 이상이 어둠인가",
      "네온 컬러 (핑크/블루/퍼플)가 지배적인가",
      "젖은 표면 반사가 있는가",
      "강한 림라이트가 캐릭터를 감싸는가",
    ],
  },
  "vhs-retro": {
    title: "VHS 아날로그 비디오 아티스트",
    aesthetic: "자기 테이프에 녹화된 것처럼 보여야 한다. 스캔라인, 트래킹 노이즈, 색 번짐이 핵심 미학.",
    failureCriteria: "디지털 선명함, 4K 해상도, 현대적 색보정, 깨끗한 이미지가 보이면 실패.",
    qualityChecklist: [
      "스캔라인이 보이는가",
      "색번짐/크로매틱 왜곡이 있는가",
      "해상도가 의도적으로 낮은가",
      "VHS 트래킹 노이즈가 있는가",
    ],
  },
  "sf-futuristic": {
    title: "SF 미래도시 비주얼 디자이너",
    aesthetic: "기술적으로 경이로운 미래 세계. 홀로그램, 투명 디스플레이, 메탈릭 표면이 핵심.",
    failureCriteria: "중세/전원 배경, 자연 풍경, 따뜻한 흙 톤, 역사적 건축이 보이면 실패.",
    qualityChecklist: [
      "미래적 건축/기술이 보이는가",
      "홀로그램/UI 요소가 있는가",
      "메탈릭/유리 표면 반사가 있는가",
      "볼류메트릭 안개/입자 효과가 있는가",
    ],
  },
  "gothic-horror": {
    title: "고딕 호러 아트디렉터",
    aesthetic: "공포와 불안이 시각적으로 느껴져야 한다. 깊은 그림자, 부식된 소재, 안개, 불안한 카메라 각도.",
    failureCriteria: "밝은 조명, 따뜻한 색감, 깨끗한 환경, 밝고 쾌활한 분위기가 보이면 실패.",
    qualityChecklist: [
      "조명이 최소한이고 불안한가",
      "색이 탈색된 한랭 톤인가",
      "부식/낡은 소재가 보이는가",
      "카메라 각도가 불안감을 주는가",
    ],
  },

  // ─── 2D 애니 계열 ─────────────────────────────────────
  "tv-anime": {
    title: "TV 애니메이션 작화감독",
    aesthetic: "깨끗한 외곽선, 셀 셰이딩, 선명한 색분리. 일본 TV 애니의 정석적 느낌.",
    failureCriteria: "실사 피부 질감, 3D 렌더링, 사진 같은 배경, 유화 터치가 보이면 실패.",
    qualityChecklist: [
      "외곽선이 깨끗하고 일관적인가",
      "셀 셰이딩 (평면 음영)이 적용되었는가",
      "캐릭터가 애니 비율인가 (큰 눈 등)",
      "배경이 일러스트 스타일인가",
    ],
  },
  "theatrical-anime": {
    title: "극장판 애니메이션 총감독",
    aesthetic: "모든 프레임이 한 장의 그림 이상이어야 한다. TV 애니와 달리 배경 밀도, 조명 깊이, 프레임 수가 압도적이어야 한다.",
    failureCriteria: "TV급 한정 작화, 단순한 배경, 부족한 조명 표현이 보이면 실패.",
    qualityChecklist: [
      "배경 디테일이 극장급인가",
      "조명에 깊이감이 있는가 (볼류메트릭)",
      "캐릭터 작화가 밀도 높은가",
      "카메라 워크가 시네마틱한가",
    ],
  },
  "storybook-anime": {
    title: "동화책 애니메이션 아트디렉터",
    aesthetic: "어린이 그림책에서 튀어나온 것처럼 부드럽고 따뜻하고 둥근 세계.",
    failureCriteria: "날카로운 애니 외곽선, 어두운 분위기, 폭력적 이미지, 리얼리스틱 표현이 보이면 실패.",
    qualityChecklist: [
      "색감이 부드러운 파스텔/따뜻한 톤인가",
      "캐릭터가 둥글고 친근한가",
      "조명이 부드럽고 그림자가 약한가",
      "전체적으로 '따뜻한' 느낌인가",
    ],
  },
  "painted-2d": {
    title: "회화 애니메이션 감독",
    aesthetic: "모든 프레임이 캔버스 위의 살아있는 그림이어야 한다. 붓터치가 움직이고, 물감이 흐르는 느낌이 핵심.",
    failureCriteria: "사진 같은 렌더링, 정지된 일러스트, 디지털적으로 깨끗한 표면, 평면 벡터 아트가 보이면 실패.",
    qualityChecklist: [
      "붓터치가 눈에 보이는가",
      "캔버스/종이 질감이 있는가",
      "색이 물감처럼 혼합/번지는가",
      "정지 화면이 아닌 '살아있는 그림'인가",
    ],
  },
  "watercolor-animation": {
    title: "수채화 애니메이션 아트디렉터",
    aesthetic: "투명 수채의 맑은 번짐, 종이가 비치는 색층, 물과 물감의 만남. 유화와는 완전히 다른 맑음이 핵심.",
    failureCriteria: "불투명한 색면, 셀 셰이딩, 날카로운 외곽선, 디지털 렌더링, 짙고 무거운 색감이 보이면 실패.",
    qualityChecklist: [
      "색이 투명하게 겹쳐 있는가",
      "종이 질감이 비치는가",
      "물감 번짐 효과가 있는가",
      "전체적으로 맑고 가벼운 느낌인가",
    ],
  },
  "webtoon-motion": {
    title: "웹툰 모션 디렉터",
    aesthetic: "한국 웹툰의 깨끗한 디지털 라인과 강렬한 색감. 패널 전환과 모션 이펙트가 핵심.",
    failureCriteria: "일본 애니 스타일, 수채화 텍스처, 거친 손그림, 3D CGI가 보이면 실패.",
    qualityChecklist: [
      "라인아트가 깨끗한 디지털인가",
      "색이 선명하고 평면적인가",
      "만화적 스피드 라인/충격 프레임이 있는가",
      "캐릭터가 만화 비율 (날카로운 턱선)인가",
    ],
  },
  "ink-drawing-anime": {
    title: "잉크 드로잉 애니메이션 감독",
    aesthetic: "펜과 잉크의 대담한 선, 크로스해칭 음영, 흰 종이 위 검은 잉크의 극적 대비. 건축적 정밀함과 캐릭터의 표현적 자유로움이 공존.",
    failureCriteria: "풀 컬러 채색, 셀 셰이딩, 포토리얼, 매끈한 디지털, 3D 렌더링이 보이면 실패.",
    qualityChecklist: [
      "잉크 선의 강약 변화가 있는가",
      "크로스해칭으로 음영이 표현되었는가",
      "흰 종이 위 검은 잉크의 대비가 분명한가",
      "잉크 튀김/번짐 텍스처가 있는가",
    ],
  },
  "cutout-anime": {
    title: "컷아웃 애니메이션 아트디렉터",
    aesthetic: "종이를 오려 만든 평면 레이어. 가위로 자른 경계면, 힌지 관절 움직임, 레이어 사이 그림자가 핵심.",
    failureCriteria: "3D 깊이감, 포토리얼, 부드러운 자연 동작, 셀 셰이딩, 필름 그레인이 보이면 실패.",
    qualityChecklist: [
      "종이 잘린 가장자리가 보이는가",
      "힌지 관절 움직임인가",
      "레이어 사이 그림자 깊이가 있는가",
      "종이 질감(크래프트지/색지)이 느껴지는가",
    ],
  },

  // ─── 3D 애니 계열 ─────────────────────────────────────
  "pixar-style": {
    title: "픽사풍 3D 아트디렉터",
    aesthetic: "부드러운 피부 표면산란, 매력적인 비율의 캐릭터, 풍부한 글로벌 일루미네이션. 따뜻함과 매력이 핵심.",
    failureCriteria: "평면 2D, 사진급 리얼리즘, 언캐니 밸리, 로우폴리, 어두운 분위기가 보이면 실패.",
    qualityChecklist: [
      "캐릭터 비율이 매력적으로 과장되었는가",
      "피부에 서브서피스 스캐터링이 있는가",
      "조명이 따뜻하고 풍부한가",
      "전체적으로 '따뜻한 매력'이 있는가",
    ],
  },
  "dreamworks-style": {
    title: "드림웍스풍 3D 아트디렉터",
    aesthetic: "과감하게 과장된 캐릭터 비율, 역동적 포즈, 강렬한 색대비. 에너지 넘치는 카메라와 드라마틱 조명이 핵심.",
    failureCriteria: "포토리얼, 평면 2D, 차분한 색감, 정적 포즈, 언캐니 밸리가 보이면 실패.",
    qualityChecklist: [
      "캐릭터 비율이 과감하게 과장되었는가",
      "포즈와 표정이 역동적인가",
      "색감이 선명하고 대비가 강한가",
      "카메라 움직임이 에너지 넘치는가",
    ],
  },
  "stylized-3d": {
    title: "스타일라이즈드 3D 아트디렉터",
    aesthetic: "3D 지오메트리 위에 툰 셰이딩. 굵은 외곽선, 평면 색면, 날카로운 그림자 경계. 만화를 3D로 구현한 느낌.",
    failureCriteria: "포토리얼 렌더링, 서브서피스 스캐터링, 사실적 피부, 필름 그레인, 2D 손그림이 보이면 실패.",
    qualityChecklist: [
      "3D 모델 위 툰 셰이딩이 적용되었는가",
      "외곽선이 굵고 일관적인가",
      "색면이 평면적이고 만화적인가",
      "비율이 과장된 카툰 스타일인가",
    ],
  },
  "low-poly-3d": {
    title: "로우폴리 3D 아트디렉터",
    aesthetic: "보이는 기하학적 면, 최소한의 텍스처, 재질 자체의 색으로만 표현. 평화로운 미니멀 미학.",
    failureCriteria: "하이폴리 디테일, 사실적 텍스처, 필름 그레인, 포토리얼, 복잡한 유기적 형태가 보이면 실패.",
    qualityChecklist: [
      "폴리곤 면이 명확히 보이는가",
      "플랫 셰이딩이 적용되었는가",
      "색상 팔레트가 절제되어 있는가",
      "미니멀하고 기하학적인 느낌인가",
    ],
  },
  "miniature-3d": {
    title: "미니어처 3D 아트디렉터",
    aesthetic: "틸트시프트 효과로 모든 것이 장난감 디오라마처럼 보인다. 극단적 얕은 피사계 심도, 약간 과채도, 밝은 탑다운 조명.",
    failureCriteria: "일반 인간 스케일, 딥포커스, 사실적 비율, 자연스러운 원근이 보이면 실패.",
    qualityChecklist: [
      "틸트시프트 피사계 심도가 적용되었는가",
      "미니어처/장난감 스케일이 느껴지는가",
      "탑다운 또는 약간 높은 시점인가",
      "색이 약간 과채도되어 귀여운가",
    ],
  },
  "semi-real-3d": {
    title: "반실사 3D 비주얼 감독",
    aesthetic: "배경은 사실적이되 캐릭터는 스타일라이즈. 두 세계의 조화로운 공존이 핵심.",
    failureCriteria: "순수 포토리얼 또는 순수 플랫 애니만 보이면 실패. 혼합 감이 없으면 실패.",
    qualityChecklist: [
      "배경이 사실적 수준인가",
      "캐릭터가 약간 스타일라이즈되었는가",
      "두 렌더링 스타일이 자연스럽게 공존하는가",
      "시네마틱 조명이 적용되었는가",
    ],
  },
  "game-cinematic-3d": {
    title: "게임 시네마틱 디렉터",
    aesthetic: "AAA 게임 트레일러 퀄리티. 영웅적 조명, 극적 카메라, 입자 효과. 에픽함이 핵심.",
    failureCriteria: "로우폴리, 카툰, 2D, 수채화, 핸드드로잉이 보이면 실패.",
    qualityChecklist: [
      "렌더링 퀄리티가 AAA급인가",
      "카메라 안무가 극적인가",
      "조명이 영웅적/드라마틱한가",
      "입자/볼류메트릭 효과가 있는가",
    ],
  },

  // ─── 회화 계열 ────────────────────────────────────────
  "ink-wash": {
    title: "수묵풍 2D 애니메이션 아트디렉터",
    aesthetic: "먹의 농담, 한지의 질감, 여백의 미를 활용한 2D 애니메이션. 정적 그림이 아니라 살아 움직이는 시퀀스. 적을수록 더 많이 말하는 동양 미학을 '움직이는 2D 애니'로 표현.",
    failureCriteria: "정적 그림/족자/병풍처럼 보이면 실패. 한자/서예/문자 장식이 보이면 실패. 화려한 색채, 디지털 깨끗함, 포토리얼, 3D CGI, 셀 색감이 보이면 실패. motion poster(정지 그림이 살짝 움직이는 것)도 실패.",
    qualityChecklist: [
      "살아 움직이는 2D 애니메이션 시퀀스인가 (정적 그림 ❌)",
      "먹 농담의 변화가 풍부한가",
      "한지/화선지 질감이 있는가",
      "의도적 여백이 구도 요소인가",
      "문자/한자/서예 요소가 없는가 (텍스트 완전 배제)",
      "캐릭터와 배경 모두 동양화풍 렌더링인가",
    ],
  },
  "east-asian-painting": {
    title: "동양화풍 2D 애니메이션 아트디렉터",
    aesthetic: "동양화의 붓선, 담채 색감, 여백과 평면성을 활용한 2D 애니메이션. 병풍/족자 감상이 아니라 진행되는 animated sequence. hand-painted 느낌의 2D 동양화풍 움직임.",
    failureCriteria: "정적 그림/족자/병풍/scroll painting처럼 보이면 실패. 한자/서예/문자 요소가 보이면 실패. 포토리얼, 3D, 인포그래픽 지도처럼 보이면 실패. motion poster도 실패.",
    qualityChecklist: [
      "2D 애니메이션으로 살아 움직이는가 (정적 작품 ❌)",
      "붓선/먹선의 동양화 질감이 있는가",
      "담채/절제된 색감인가",
      "여백과 평면성의 리듬감이 있는가",
      "문자/한자/서예 요소가 전혀 없는가",
      "디지털 포스터가 아닌 hand-painted 2D 느낌인가",
    ],
  },
  "van-gogh-painted": {
    title: "고흐풍 후기인상파 아트디렉터",
    aesthetic: "소용돌이치는 붓터치, 강렬한 보색 대비, 캔버스에서 살아 움직이는 에너지.",
    failureCriteria: "평면 색감, 깨끗한 디지털, 포토리얼, 매끈한 렌더링이 보이면 실패.",
    qualityChecklist: [
      "소용돌이 에너지의 붓터치가 있는가",
      "보색 대비 (파랑-노랑)가 강한가",
      "임파스토 두께감이 있는가",
      "붓터치가 방향성을 가지는가",
    ],
  },
  "watercolor": {
    title: "수채화 아트디렉터",
    aesthetic: "투명한 물감 층이 겹치는 맑은 번짐. 종이 질감이 비치고, 물과 물감이 만나는 우연한 효과가 핵심.",
    failureCriteria: "불투명한 물감, 두꺼운 임파스토, 디지털 렌더링, 포토리얼, 날카로운 외곽선이 보이면 실패.",
    qualityChecklist: [
      "물감이 투명하게 겹쳐 있는가",
      "종이 질감이 비치는가",
      "물감 번짐/블리딩 효과가 있는가",
      "전체적으로 맑고 가벼운 느낌인가",
    ],
  },
  "gouache": {
    title: "구아슈 아트디렉터",
    aesthetic: "불투명한 매트 색면, 부드러운 붓결. 광택 없는 풍부한 채도와 평면적 레이어 분리가 핵심.",
    failureCriteria: "광택 있는 마감, 투명 수채, 포토리얼, 디지털 깨끗함, 두꺼운 임파스토가 보이면 실패.",
    qualityChecklist: [
      "색면이 불투명하고 매트한가",
      "붓결 방향이 미세하게 보이는가",
      "채도가 풍부하되 광택이 없는가",
      "전경/배경 레이어 분리가 명확한가",
    ],
  },
  "pastel": {
    title: "파스텔 아트디렉터",
    aesthetic: "부드러운 초크 질감, 종이 결이 비치는 가루 같은 색층. 몽환적이고 부드러운 분위기가 핵심.",
    failureCriteria: "날카로운 경계, 강렬한 채도, 디지털 깨끗함, 포토리얼, 잉크 라인, 강한 대비가 보이면 실패.",
    qualityChecklist: [
      "초크/크레용 질감이 있는가",
      "종이 결이 비치는가",
      "색 전환이 부드럽고 몽환적인가",
      "전체적으로 부드러운 파스텔 톤인가",
    ],
  },
  "inkwash-painting": {
    title: "잉크 워시 페인팅 아트디렉터",
    aesthetic: "서양식 잉크 워시. 검은 잉크를 다양한 회색 톤으로 희석한 유동적 붓자국. 형태를 정의하기보다 암시하는 제스처럴 마크.",
    failureCriteria: "날카로운 외곽선, 풀 컬러, 디지털 렌더링, 포토리얼, 셀 셰이딩이 보이면 실패.",
    qualityChecklist: [
      "잉크 농담의 변화가 풍부한가",
      "젖은 붓의 유동적 자국이 있는가",
      "형태가 암시적으로 표현되는가",
      "무거운 수채화지 질감이 느껴지는가",
    ],
  },
  "editorial-illustration": {
    title: "에디토리얼 일러스트 아트디렉터",
    aesthetic: "대담한 그래픽 구도, 강한 실루엣, 3~4색 제한 팔레트. 시각적 메타포와 잡지급 디자인 감각이 핵심.",
    failureCriteria: "포토리얼, 애니메, 전체 색 스펙트럼, 3D 렌더링, 필름 그레인이 보이면 실패.",
    qualityChecklist: [
      "구도가 대담하고 그래픽적인가",
      "색상 팔레트가 3~4색으로 제한적인가",
      "시각적 메타포가 있는가",
      "플랫 색면과 디테일 포인트가 공존하는가",
    ],
  },
  "storybook-illustration": {
    title: "동화책 일러스트 아트디렉터",
    aesthetic: "따뜻한 색감, 둥글고 친근한 캐릭터, 세밀한 미니어처 세계 구축. 수채/구아슈 질감의 손으로 그린 마법적 분위기.",
    failureCriteria: "어두운 호러, 사실적 폭력, 포토리얼, 날카로운 애니, 산업적/디스토피아 느낌이 보이면 실패.",
    qualityChecklist: [
      "색감이 따뜻하고 부드러운가",
      "캐릭터가 둥글고 친근한가",
      "배경에 세밀한 미니어처 세계가 있는가",
      "수작업 질감과 마법적 분위기가 있는가",
    ],
  },
  "oil-painting": {
    title: "유화 아트디렉터",
    aesthetic: "두꺼운 유화 물감의 텍스처, 키아로스쿠로 명암, 고전 회화의 구도와 색조화.",
    failureCriteria: "투명 수채, 디지털 깨끗함, 포토리얼, 셀 셰이딩이 보이면 실패.",
    qualityChecklist: [
      "유화 물감 두께가 느껴지는가",
      "명암이 드라마틱한가 (키아로스쿠로)",
      "색 혼합이 캔버스 위에서 일어난 느낌인가",
      "고전 구도/색조화가 있는가",
    ],
  },

  // ─── 스톱모션 계열 ────────────────────────────────────
  "claymation": {
    title: "클레이메이션 아트디렉터",
    aesthetic: "손자국이 남아있는 점토의 따뜻한 질감. 프레임마다 미세하게 변형되는 점토의 살아있음.",
    failureCriteria: "디지털 렌더링, 매끈한 CGI, 포토리얼, 반들반들한 플라스틱, 2D 애니가 보이면 실패.",
    qualityChecklist: [
      "점토 표면에 손자국/질감이 있는가",
      "스톱모션 프레임 지터가 있는가",
      "조명이 스튜디오 미니어처급인가",
      "소재(점토/플라스티신)가 분명히 보이는가",
    ],
  },
  "paper-collage": {
    title: "종이 콜라주 아트디렉터",
    aesthetic: "가위로 자른 종이 레이어, 신문지/크래프트지/잡지 클리핑의 조합. 풀과 테이프 자국, 레이어 사이 그림자가 핵심.",
    failureCriteria: "매끈한 디지털, 3D CGI, 포토리얼, 깨끗한 벡터 아트, 자연스러운 움직임이 보이면 실패.",
    qualityChecklist: [
      "가위 자른 종이 가장자리가 보이는가",
      "다양한 종이 질감이 혼합되어 있는가",
      "레이어 사이 그림자 깊이가 있는가",
      "수공예 느낌(풀/테이프 자국)이 있는가",
    ],
  },
  "felt-craft": {
    title: "펠트 공예 아트디렉터",
    aesthetic: "부드러운 펠트 원단 질감, 바느질 자국과 천 이음매. 단추 눈과 자수 디테일, 포근한 수공예 미학.",
    failureCriteria: "딱딱한 표면, 금속 재질, 디지털 렌더링, 포토리얼, 날카로운 경계가 보이면 실패.",
    qualityChecklist: [
      "펠트 원단 질감이 모든 표면에 있는가",
      "바느질/이음매가 보이는가",
      "가장자리에 섬유 보풀이 있는가",
      "포근하고 따뜻한 수공예 느낌인가",
    ],
  },
  "wooden-puppet": {
    title: "목각 인형 아트디렉터",
    aesthetic: "나무결이 보이는 조각된 캐릭터, 관절 연결 부위, 마리오네트 움직임. 따뜻한 나무 톤과 극장식 조명.",
    failureCriteria: "유연한 사실적 움직임, 디지털 렌더링, 매끈한 CGI, 포토리얼 피부가 보이면 실패.",
    qualityChecklist: [
      "나무 결과 조각 질감이 보이는가",
      "관절/힌지 연결 부위가 있는가",
      "마리오네트적 움직임인가",
      "따뜻한 나무 톤과 극장 조명인가",
    ],
  },
  "paper-puppet": {
    title: "종이 인형극 아트디렉터",
    aesthetic: "역광 반투명 스크린 위 실루엣 캐릭터. 정교한 종이 커팅 디테일, 따뜻한 호박색 역광, 전통 그림자극의 관절 움직임.",
    failureCriteria: "풀 컬러, 3D 렌더링, 포토리얼, 주광 장면, 현대 디지털이 보이면 실패.",
    qualityChecklist: [
      "실루엣 형태가 역광으로 표현되는가",
      "종이 커팅의 정교한 디테일이 있는가",
      "관절 인형의 움직임인가",
      "따뜻한 호박색 역광이 있는가",
    ],
  },
  "miniature-diorama": {
    title: "미니어처 디오라마 아트디렉터",
    aesthetic: "수공예 세트의 촉감. 직물, 나무, 종이의 실제 소재감. 프레임별 촬영의 독특한 리듬.",
    failureCriteria: "매끈한 CGI, 디지털 깨끗함, 플라스틱 장난감 느낌, 포토리얼, 2D 애니가 보이면 실패.",
    qualityChecklist: [
      "실제 소재(천/나무/종이)가 보이는가",
      "미니어처 스케일이 느껴지는가",
      "스톱모션 프레임 지터가 있는가",
      "수공예 '불완전함'이 있는가",
    ],
  },

  // ─── 레트로 계열 ──────────────────────────────────────
  "pixel-art": {
    title: "픽셀아트 시네마틱 디자이너",
    aesthetic: "선명한 픽셀 그리드, 안티앨리어싱 없는 깨끗한 도트. 제한된 색상 안에서의 표현력이 핵심.",
    failureCriteria: "매끈한 렌더링, 안티앨리어싱된 가장자리, 3D, 포토리얼, 고해상도 디테일이 보이면 실패.",
    qualityChecklist: [
      "픽셀 그리드가 선명한가",
      "안티앨리어싱이 없는가",
      "색상 팔레트가 제한적인가",
      "스프라이트가 블록 비율인가",
    ],
  },
  "16bit-jrpg": {
    title: "16비트 JRPG 아트디렉터",
    aesthetic: "슈퍼패미컴 시대의 풍부한 픽셀 배경, 치비 캐릭터 스프라이트, 256색 팔레트 안에서의 디더링 기법. RPG UI 요소가 포함된 노스탤지어.",
    failureCriteria: "3D 렌더링, 고해상도, 부드러운 애니메이션, 포토리얼, 현대 그래픽이 보이면 실패.",
    qualityChecklist: [
      "탑다운/사이드뷰 구도인가",
      "치비 스프라이트 비율인가",
      "256색 팔레트와 디더링이 있는가",
      "SNES 시대 느낌의 따뜻한 색감인가",
    ],
  },
  "8bit-arcade": {
    title: "8비트 아케이드 아트디렉터",
    aesthetic: "극도로 제한된 색상(스프라이트당 최대 4색), 큰 픽셀, 단순한 기하학적 캐릭터. 검은 배경에 원색 대비, 아케이드 게임 미학.",
    failureCriteria: "고해상도, 디테일한 텍스처, 3D, 부드러운 그라디언트, 현대 그래픽이 보이면 실패.",
    qualityChecklist: [
      "스프라이트당 색이 극도로 제한되었는가",
      "픽셀이 크고 그리드가 선명한가",
      "캐릭터가 단순한 기하 형태인가",
      "전체적으로 NES/패미컴 시대 느낌인가",
    ],
  },
  "90s-game-cutscene": {
    title: "90년대 게임 컷신 아트디렉터",
    aesthetic: "초기 CG 렌더링, 고로 셰이딩, 메탈릭/크롬 반사, 렌즈 플레어, 로우폴리 캐릭터와 프리렌더 배경의 극적 만남.",
    failureCriteria: "현대 레이트레이싱, 포토리얼, 2D 애니, 손그림, 픽셀아트, 자연광이 보이면 실패.",
    qualityChecklist: [
      "초기 CG 느낌의 고로 셰이딩이 있는가",
      "메탈릭/크롬 반사 효과가 있는가",
      "렌즈 플레어/스타버스트가 있는가",
      "90년대 CG 특유의 극적 카메라 회전이 있는가",
    ],
  },
  "visual-novel": {
    title: "비주얼 노벨 아트디렉터",
    aesthetic: "정적 또는 미세 애니메이션된 캐릭터 포트레이트, 일러스트 배경, 깨끗한 애니풍 캐릭터 아트와 분위기에 따른 색온도 변화.",
    failureCriteria: "풀 3D, 포토리얼, 픽셀아트, 액션 애니메이션, 거친 손그림, 필름 그레인이 보이면 실패.",
    qualityChecklist: [
      "캐릭터가 포트레이트 형식으로 배치되었는가",
      "배경이 일러스트 스타일인가",
      "분위기에 맞는 색온도 변화가 있는가",
      "잔잔한 파티클 효과(벚꽃/눈 등)가 있는가",
    ],
  },
  "ps1-lowpoly": {
    title: "PS1 로우폴리 아트디렉터",
    aesthetic: "어파인 텍스처 워핑, 버텍스 스내핑, 안개 디스턴스 렌더링. PS1 시대의 독특한 3D 미학.",
    failureCriteria: "하이폴리, 레이트레이싱, 매끈한 텍스처, 현대 그래픽이 보이면 실패.",
    qualityChecklist: [
      "폴리곤 가장자리가 보이는가",
      "텍스처가 흔들리는 어파인 효과가 있는가",
      "안개 디스턴스 렌더링이 있는가",
      "전체적으로 '그리운 초기 3D' 느낌인가",
    ],
  },

  // ─── 실험 계열 ────────────────────────────────────────
  "rotoscoping": {
    title: "로토스코핑 아트디렉터",
    aesthetic: "실제 인간 움직임 위에 회화적 레이어. 사실적 모션과 예술적 표현의 결합.",
    failureCriteria: "일반 카툰, 제너릭 애니, 깨끗한 디지털 외곽선, 기계적 뻣뻣한 움직임이 보이면 실패.",
    qualityChecklist: [
      "움직임이 실제 연기 기반인가",
      "회화적 오버레이가 프레임마다 있는가",
      "손으로 트레이싱한 외곽선 느낌인가",
      "다큐-회화 혼합 질감이 있는가",
    ],
  },
  "mixed-media-collage": {
    title: "믹스드 미디어 콜라주 아트디렉터",
    aesthetic: "사진, 일러스트, 직물 텍스처, 인쇄물의 층층이 겹친 조합. 매체 간 이음매가 보이는 컷앤페이스트 미학, 실험적 구도.",
    failureCriteria: "균일한 단일 스타일, 깨끗한 디지털, 포토리얼만, 순수 애니, 일관된 매끈한 렌더링이 보이면 실패.",
    qualityChecklist: [
      "다양한 매체(사진/그림/직물)가 혼합되어 있는가",
      "매체 간 이음매/경계가 보이는가",
      "질감의 다양성(종이/직물/사진 광택)이 있는가",
      "전통적 프레이밍을 깨는 실험적 구도인가",
    ],
  },
  "live-paint-overlay": {
    title: "실사+페인트 오버레이 아트디렉터",
    aesthetic: "실사 영상 위에 손으로 그린 페인트/잉크 레이어. 사진과 회화가 한 프레임에 공존하며, 붓자국이 움직임에 반응.",
    failureCriteria: "순수 포토리얼만, 순수 페인팅만, 깨끗한 디지털 합성, 애니, 3D CGI가 보이면 실패.",
    qualityChecklist: [
      "실사 베이스 레이어가 보이는가",
      "그 위에 페인트/잉크 오버레이가 있는가",
      "붓자국이 움직임에 반응하는가",
      "사진과 회화가 한 프레임에 공존하는가",
    ],
  },
  "docu-illustrated": {
    title: "다큐+일러스트 오버레이 아트디렉터",
    aesthetic: "다큐멘터리 실사 영상 위에 애니메이션 일러스트/인포그래픽이 떠다닌다. 현실 위에 그려진 주석과 다이어그램이 교육적이면서 예술적.",
    failureCriteria: "순수 픽션, 판타지 요소, 순수 애니메이션만, 순수 실사만이 보이면 실패.",
    qualityChecklist: [
      "다큐멘터리 실사 베이스가 있는가",
      "그 위에 애니메이션 일러스트가 있는가",
      "인포그래픽/다이어그램 요소가 있는가",
      "교육적이면서 예술적 스토리텔링인가",
    ],
  },
  "2d-3d-hybrid": {
    title: "2D/3D 하이브리드 아트디렉터",
    aesthetic: "2D 손그림 캐릭터가 3D 렌더링 환경 안에서 움직인다. 캐릭터와 환경의 렌더링 차이가 명확하면서도 자연스럽게 공존.",
    failureCriteria: "균일한 단일 렌더링 스타일, 순수 2D만, 순수 3D만, 순수 포토리얼이 보이면 실패.",
    qualityChecklist: [
      "캐릭터가 2D 스타일로 렌더링되었는가",
      "환경이 3D로 렌더링되었는가",
      "두 스타일이 한 프레임에 자연스럽게 공존하는가",
      "3D 공간을 통한 시네마틱 카메라 움직임이 있는가",
    ],
  },
  "surreal-composite": {
    title: "초현실 합성 비주얼 아티스트",
    aesthetic: "꿈의 논리, 불가능한 건축, 중력을 무시하는 구도. 불안과 경이의 공존.",
    failureCriteria: "논리적 물리 법칙, 정상 비율, 일상적 리얼리즘, 관습적 구도가 보이면 실패.",
    qualityChecklist: [
      "물리 법칙이 의도적으로 깨졌는가",
      "스케일 왜곡이 있는가",
      "현실과 비현실이 한 프레임에 공존하는가",
      "상징적 이미지가 있는가",
    ],
  },
};

/** 카테고리별 기본 렌더링 규칙 (스타일별 오버라이드 없을 시 적용) */
const CATEGORY_RENDERING_DEFAULTS: Record<string, StyleRenderingRules> = {
  live_action: {
    characterRules: "Realistic human proportions, natural skin tones, authentic clothing with fabric physics. Maintain consistent character appearance across all cuts.",
    environmentRules: "Photorealistic environments with natural weathering, authentic materials. Volumetric atmospheric effects — fog, dust, haze.",
    cameraDefaults: "Cinematic dolly and crane movement. Anamorphic lens with shallow depth of field. Steadicam feel for walk-and-talk.",
    motionDefaults: "Natural human physics — gravity, inertia, weight. Fluid cinematic motion at 24fps feel.",
    sequenceRules: "Match lighting color temperature across cuts. Maintain consistent film grain level. Character wardrobe and hair must not change between cuts unless story demands it.",
  },
  animation_2d: {
    characterRules: "Stylized 2D character proportions with clean outlines. Cel-shaded coloring with flat shadow zones. Consistent character model sheet across all cuts.",
    environmentRules: "Illustrated backgrounds with painterly detail. Clear color separation between background layers. Parallax depth on multi-layer backgrounds.",
    cameraDefaults: "Dynamic anime camera sweeps and zooms. Speed lines for emphasis. Dramatic angle changes between cuts.",
    motionDefaults: "Anime keyframe animation with expressive timing. Limited frames on holds, high frames on action peaks. Smear frames for fast motion.",
    sequenceRules: "Character line weight and color palette must stay identical across cuts. Background art style must not shift. Maintain consistent outline thickness.",
  },
  animation_3d: {
    characterRules: "3D character models with consistent geometry and materials. Subsurface scattering on skin. Proper rigging and deformation on all poses.",
    environmentRules: "3D environments with consistent PBR materials. Global illumination with proper light bouncing. Depth of field and atmospheric perspective.",
    cameraDefaults: "Smooth 3D camera orbits and dollies. Rack focus between subjects. Depth transitions through environment.",
    motionDefaults: "Smooth 3D animation with proper weight and physics. Motion blur on fast movements. Secondary animation on hair and clothing.",
    sequenceRules: "Lighting rig must stay consistent across cuts in same scene. Character materials must not change. Environment scale must remain constant.",
  },
  painting: {
    characterRules: "Characters rendered through painting medium — visible brushwork, paint texture on all features. No clean digital edges. Style medium must be consistent (oil/watercolor/ink).",
    environmentRules: "Environments fully rendered in chosen paint medium. Atmospheric depth through paint transparency/opacity. Canvas or paper texture visible throughout.",
    cameraDefaults: "Cinematic camera movement through painted world — dollying through living paintings. Gentle panning with parallax on paint layers.",
    motionDefaults: "Painted animation where brushwork flows with movement. Each frame is a new painting, not a tweened digital morph. Paint texture actively shifts.",
    sequenceRules: "Paint medium must not change between cuts. Brushwork density and texture must stay consistent. Color palette mixing style must be uniform.",
  },
  stop_motion: {
    characterRules: "Handcrafted character figures with visible material construction. Tactile surfaces — clay, fabric, felt. Material imperfections present and consistent.",
    environmentRules: "Miniature handcrafted sets with visible construction materials. Warm studio lighting. Craft imperfections as aesthetic feature.",
    cameraDefaults: "Miniature-scale camera movement — subtle shifts and nudges. Stop-motion camera increments. Table-top perspective.",
    motionDefaults: "Frame-by-frame stop-motion jitter. Tactile material deformation between frames. No smooth tweened motion.",
    sequenceRules: "Material type must stay consistent (all clay or all felt, not mixed unless intentional). Lighting rig position must not shift. Scale proportion must remain constant.",
  },
  retro_game: {
    characterRules: "Pixel or low-poly character representation per era. Limited color palette per sprite. Period-appropriate resolution and anti-aliasing (or lack thereof).",
    environmentRules: "Period-appropriate environment rendering — tile-based, pre-rendered, or polygon. Era-specific fog and draw distance.",
    cameraDefaults: "Era-appropriate camera — side-scroll, isometric, fixed angle, or early 3D orbit. Pixel-aligned movement for 2D styles.",
    motionDefaults: "Limited keyframe animation appropriate to era. No smooth modern interpolation. Period-correct movement constraints.",
    sequenceRules: "Resolution and color palette must stay locked to chosen era. No mixing eras (8-bit characters in 32-bit backgrounds). Consistent pixel density.",
  },
  experimental: {
    characterRules: "Characters may span multiple rendering styles. The hybrid mix must be intentional and consistent within the project's established visual logic.",
    environmentRules: "Environments may layer multiple media types. The combination must serve artistic purpose, not appear accidental.",
    cameraDefaults: "Camera style matches the dominant medium or creates intentional tension between media layers.",
    motionDefaults: "Motion style reflects the chosen experimental mix — rotoscoped base with painted overlay, or real footage with illustrated elements.",
    sequenceRules: "The specific experimental mix ratio must stay consistent across cuts. If 70% real / 30% painted, that ratio must hold. Anti-drift is critical in hybrid styles.",
  },
};

/** 스타일별 커스텀 렌더링 규칙 오버라이드 (없으면 카테고리 기본값 사용) */
const STYLE_RENDERING_OVERRIDES: Record<string, Partial<StyleRenderingRules>> = {
  "docu-handheld": {
    cameraDefaults: "Handheld camera with natural shake. Observational distance. No stabilized gimbal. Whip pans when following action.",
    motionDefaults: "Real-world motion capture feel. No choreographed camera movements. Reactive following, not leading.",
  },
  "vintage-film": {
    motionDefaults: "Slightly degraded film motion with frame judder. Vintage camera stability (not perfect). Occasional sprocket hole flash.",
    sequenceRules: "Film grain level and color fade must stay identical across all cuts. Light leak style must be consistent. No mixing different film stocks.",
  },
  "neon-noir": {
    environmentRules: "Dark cyberpunk cityscapes with neon tubes and glowing panels. Wet reflective streets. Atmospheric fog catching colored light. 70%+ of frame should be dark.",
    cameraDefaults: "Neon-reflected tracking shots. Rain-slicked gliding movement. Low angles looking up at neon signs. Dutch tilts for tension.",
  },
  "theatrical-anime": {
    cameraDefaults: "Sweeping cinematic anime camera. Fluid parallax on deep background layers. Dramatic push-ins with depth. Dolly across epic vistas.",
    motionDefaults: "High frame-count fluid animation. Detailed secondary motion on hair and cloth. Impact frames with screen shake. Wind particle effects.",
  },
  "watercolor-animation": {
    characterRules: "Characters rendered in transparent watercolor washes — no opaque surfaces. Soft undefined edges where paint meets paint. White paper visible through all elements.",
    motionDefaults: "Watercolor paint spreading and flowing with character movement. Wet-on-wet bleeding at motion edges. Colors mix as elements overlap.",
  },
  "pixel-art": {
    cameraDefaults: "Pixel-aligned scroll movement. No sub-pixel motion. Side-scroll or isometric camera only. Clean grid-aligned movement.",
    motionDefaults: "Retro game sprite animation — limited keyframes, clear pose-to-pose. No motion blur. No smooth interpolation.",
  },
  "claymation": {
    motionDefaults: "Claymation frame-by-frame with visible material deformation between frames. Slight jitter from manual positioning. Clay surfaces subtly reshape.",
  },
  "rotoscoping": {
    characterRules: "Performance-derived human movement traced with painterly overlay. The underlying human motion must feel authentic. Paint layer adds style, not replaces motion.",
    cameraDefaults: "Organic handheld documentary camera. Not perfectly stabilized. Camera reacts to action naturally, not choreographed.",
  },
  "east-asian-painting": {
    characterRules: "Characters rendered with East Asian painting brushwork — soft ink lines, muted mineral colors. Hand-painted 2D look, NOT static traditional artwork. Characters must be animated with fluid motion. ABSOLUTELY NO text, letters, calligraphy, Chinese/Korean/Japanese characters, typographic marks anywhere.",
    environmentRules: "Backgrounds in ink wash and mineral pigment style. Atmospheric layered depth with misty perspective. Hanji/rice paper surface texture hint. Flowing brush textures. NO text, labels, signs, or readable symbols in environment.",
    cameraDefaults: "2D animation camera — smooth pans, parallax on painted layers, gentle push-ins revealing detail. Avoid static art display feel.",
    motionDefaults: "Fluid 2D animated motion — NOT a motion poster with slight movement. Characters and elements must move with clear action beats. Brush textures flow with movement. Each moment is a living animated frame.",
    sequenceRules: "This is a 2D animated sequence, NOT a static artwork display. Each shot must contain multiple visual beats. Paint style must stay consistent. NO text/calligraphy/characters at any point in any scene.",
  },
  "ink-wash": {
    characterRules: "Characters rendered in sumi-e ink brushwork — varying ink density, deliberate brushstrokes. Animated 2D movement, NOT static ink painting. ABSOLUTELY NO text, calligraphy, Chinese/Korean/Japanese characters, typographic marks.",
    environmentRules: "Monochrome ink wash environments with deliberate white space. Rice paper texture. Atmospheric ink gradients. NO text, labels, or readable symbols.",
    cameraDefaults: "2D animation camera through ink wash world — smooth pans with parallax on ink layers. Gentle reveals and transitions. Avoid art plate / scroll painting feel.",
    motionDefaults: "Animated ink brush movement — NOT a static painting with slight zoom. Characters and elements must actively move. Ink density and white space shift dynamically.",
    sequenceRules: "This is an animated 2D sequence in ink wash style, NOT a scroll painting display. Multiple visual beats per shot. NO text/calligraphy/characters/letters at any point.",
  },
};

// ─── 페르소나 & 규칙 조회 API ────────────────────────────────────

/** 스타일의 전용 페르소나 반환 (없으면 카테고리 기반 기본값 생성) */
export function getStylePersona(styleId: string): StylePersona {
  if (STYLE_PERSONAS[styleId]) return STYLE_PERSONAS[styleId];

  const style = getStyleById(styleId);
  if (!style) {
    return {
      title: "비주얼 아트디렉터",
      aesthetic: "프로젝트 스타일의 일관성을 유지한다.",
      failureCriteria: "스타일이 일관적이지 않으면 실패.",
      qualityChecklist: ["스타일이 전체적으로 일관적인가"],
    };
  }

  const cat = getCategoryById(style.categoryId);
  return {
    title: `${style.nameKo} 아트디렉터`,
    aesthetic: `${style.descKo}의 미학을 일관되게 유지한다. ${style.positivePrompt.split(". ")[0]}.`,
    failureCriteria: `${style.negativePrompt.split(", ").slice(0, 3).join(", ")} 요소가 보이면 실패.`,
    qualityChecklist: [
      `${style.nameKo} 스타일이 전체적으로 일관적인가`,
      `${cat?.nameKo ?? "선택된"} 카테고리의 기본 미학이 유지되는가`,
      `네거티브 요소(${style.negativePrompt.split(", ")[0]})가 없는가`,
      "장면 간 스타일 일관성이 유지되는가",
    ],
  };
}

/** 스타일의 렌더링 규칙 반환 (카테고리 기본 + 스타일별 오버라이드 병합) */
export function getStyleRenderingRules(styleId: string): StyleRenderingRules {
  const style = getStyleById(styleId);
  const catId = style?.categoryId ?? "live_action";
  const defaults = CATEGORY_RENDERING_DEFAULTS[catId] ?? CATEGORY_RENDERING_DEFAULTS.live_action;
  const overrides = STYLE_RENDERING_OVERRIDES[styleId];

  if (!overrides) return defaults;

  return {
    characterRules: overrides.characterRules ?? defaults.characterRules,
    environmentRules: overrides.environmentRules ?? defaults.environmentRules,
    cameraDefaults: overrides.cameraDefaults ?? defaults.cameraDefaults,
    motionDefaults: overrides.motionDefaults ?? defaults.motionDefaults,
    sequenceRules: overrides.sequenceRules ?? defaults.sequenceRules,
  };
}

/** 프롬프트 조립 시 스타일 강화 블록 생성 (persona + rules → 단일 텍스트) */
export function buildStyleEnforcementBlock(styleId: string): {
  personaBlock: string;
  characterRulesBlock: string;
  environmentRulesBlock: string;
  sequenceRulesBlock: string;
  antiDriftChecklist: string[];
} {
  const persona = getStylePersona(styleId);
  const rules = getStyleRenderingRules(styleId);

  return {
    personaBlock: `[STYLE DIRECTOR: ${persona.title}] ${persona.aesthetic} FAILURE if: ${persona.failureCriteria}`,
    characterRulesBlock: rules.characterRules,
    environmentRulesBlock: rules.environmentRules,
    sequenceRulesBlock: rules.sequenceRules,
    antiDriftChecklist: persona.qualityChecklist,
  };
}
