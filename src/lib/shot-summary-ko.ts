/**
 * shot-summary-ko.ts — Korean shot summary generator for multi-shot preview
 *
 * Generates short, readable Korean summaries from cleaned English shot prompts.
 * These are UI-only — the app still sends English prompts to VEO.
 *
 * IMPORTANT: Summaries should be generated from the NORMALIZED multi_prompt
 * (via NormalizedVeoPayload.model_params.multi_prompt), NOT from raw UI shot data.
 * This ensures the visible Korean summary matches what will actually be sent to VEO.
 *
 * Approach: 3-layer — keyword mapping → noun/verb extraction → role-based fallback
 * No LLM call, no external dependency, no latency.
 */

import type { MultiShotPrompt } from "@/types";
// VEO payload types (인라인)
interface NormalizedMultiPromptEntry { index: number; prompt: string; duration: string }
interface NormalizedVeoPayload { prompt: string; negative_prompt: string; model: string; duration: string; aspect_ratio: string; sound: string; model_params?: { multi_prompt: NormalizedMultiPromptEntry[] }; _meta: { cleanupLog: string[]; shotCount: number } }

// ═══════════════════════════════════════════════════════════════════
// Layer 1: Keyword → Korean mapping tables (expanded for all genres)
// ═══════════════════════════════════════════════════════════════════

const FRAMING_KO: Record<string, string> = {
  "extreme wide": "초광각",
  "wide": "전경",
  "establishing": "전경",
  "full shot": "풀샷",
  "medium": "중간",
  "medium close-up": "중간 클로즈업",
  "close-up": "클로즈업",
  "close up": "클로즈업",
  "extreme close-up": "극접사",
  "tight": "밀착",
  "overhead": "부감",
  "bird's eye": "조감",
  "aerial": "공중",
  "low angle": "저앵글",
  "high angle": "고앵글",
  "eye-level": "눈높이",
  "dutch angle": "기울어진 앵글",
  "over-the-shoulder": "어깨 너머",
  "pov": "1인칭 시점",
  "point of view": "1인칭 시점",
};

const CAMERA_KO: Record<string, string> = {
  "push-in": "다가가며",
  "push in": "다가가며",
  "pull-back": "뒤로 빠지며",
  "pull back": "뒤로 빠지며",
  "dolly": "달리 이동",
  "dolly zoom": "달리 줌",
  "drift": "흘러가며",
  "drifting": "흘러가며",
  "pan": "패닝하며",
  "tilt": "틸트하며",
  "orbit": "공전하며",
  "tracking": "따라가며",
  "crane": "크레인",
  "handheld": "핸드헬드",
  "steadicam": "스테디캠",
  "zoom in": "줌인",
  "zoom out": "줌아웃",
  "static": "고정",
  "locked": "고정",
  "slow motion": "슬로우모션",
  "time-lapse": "타임랩스",
  "whip pan": "빠른 패닝",
};

// 범용 오브젝트/피사체 (치과 + 일상 + 판타지 + SF + 공포 + 자연 + 도시)
const OBJECT_KO: Record<string, string> = {
  // 의료
  "dental room": "치과실", "dental office": "치과", "dental tools": "치과 도구",
  "dental chair": "치과 의자", "dental drill": "치과 드릴", "drill bit": "드릴 비트",
  "scalpel": "메스", "needle": "바늘", "forceps": "겸자", "syringe": "주사기",
  "stethoscope": "청진기", "bandage": "붕대", "stretcher": "들것",
  // 일상
  "chair": "의자", "table": "테이블", "desk": "책상", "bed": "침대",
  "door": "문", "window": "창문", "phone": "폰", "laptop": "노트북",
  "car": "자동차", "bicycle": "자전거", "clock": "시계", "key": "열쇠",
  "letter": "편지", "photograph": "사진", "painting": "그림", "book": "책",
  "cup": "컵", "plate": "접시", "candle": "촛불", "umbrella": "우산",
  "bag": "가방", "shoes": "신발", "hat": "모자", "ring": "반지",
  // 도구/무기
  "drill": "드릴", "hammer": "망치", "knife": "칼", "sword": "검",
  "gun": "총", "shield": "방패", "bow": "활", "arrow": "화살",
  "torch": "횃불", "lantern": "랜턴", "rope": "밧줄",
  // 자연
  "tree": "나무", "flower": "꽃", "leaf": "잎", "river": "강",
  "waterfall": "폭포", "ocean": "바다", "wave": "파도", "cloud": "구름",
  "rain": "비", "snow": "눈", "fire": "불", "flame": "불꽃",
  "stone": "돌", "crystal": "수정", "star": "별", "moon": "달",
  "sun": "태양", "lightning": "번개", "fog": "안개", "dust": "먼지",
  // SF/판타지
  "spaceship": "우주선", "robot": "로봇", "portal": "포탈", "hologram": "홀로그램",
  "alien": "외계인", "creature": "생물", "monster": "괴물", "dragon": "드래곤",
  "magic": "마법", "spell": "주문", "orb": "구체", "artifact": "유물",
  "throne": "왕좌", "crown": "왕관", "scroll": "두루마리",
  // 상태/수식
  "tray": "트레이", "tools": "도구들", "instrument": "기구",
  "bottle": "병", "jar": "유리병", "lamp": "램프", "mirror": "거울",
  "cabinet": "캐비넷", "screen": "화면",
  "rusty": "녹슨", "antique": "골동품", "worn": "낡은", "metal": "금속",
  "spinning": "회전하는", "sharp": "날카로운", "broken": "깨진",
  "glowing": "빛나는", "floating": "떠있는", "shattered": "산산조각난",
  "burning": "타오르는", "frozen": "얼어붙은", "bleeding": "피 흘리는",
  "crumbling": "무너지는",
};

const PLACE_KO: Record<string, string> = {
  // 실내
  "room": "방", "hallway": "복도", "corridor": "복도", "staircase": "계단",
  "basement": "지하실", "attic": "다락방", "bathroom": "욕실", "kitchen": "주방",
  "bedroom": "침실", "living room": "거실", "classroom": "교실", "warehouse": "창고",
  "clinic": "병원", "hospital": "병원", "workshop": "작업실", "laboratory": "실험실",
  "studio": "스튜디오", "office": "사무실", "church": "교회", "chapel": "예배당",
  "library": "도서관", "museum": "박물관", "theater": "극장", "restaurant": "식당",
  "bar": "바", "cafe": "카페", "prison": "감옥", "dungeon": "지하감옥",
  "bunker": "벙커", "elevator": "엘리베이터", "lobby": "로비",
  // 건물/구조물
  "palace": "궁전", "castle": "성", "mansion": "저택", "house": "집",
  "cabin": "오두막", "tower": "탑", "lighthouse": "등대", "factory": "공장",
  "station": "역", "airport": "공항", "school": "학교",
  // 자연/외부
  "forest": "숲", "jungle": "정글", "desert": "사막", "tundra": "툰드라",
  "swamp": "늪", "meadow": "초원", "field": "들판", "valley": "계곡",
  "canyon": "협곡", "cliff": "절벽", "volcano": "화산",
  "street": "거리", "alley": "골목", "road": "길", "highway": "고속도로",
  "market": "시장", "plaza": "광장", "park": "공원", "cemetery": "묘지",
  "temple": "사원", "shrine": "신사", "ruins": "폐허",
  "cave": "동굴", "mine": "광산",
  "beach": "해변", "shore": "해안", "island": "섬", "dock": "부두",
  "mountain": "산", "hill": "언덕", "ridge": "산등성이",
  "village": "마을", "city": "도시", "town": "마을",
  "bridge": "다리", "tunnel": "터널", "garden": "정원",
  "rooftop": "옥상", "balcony": "발코니", "courtyard": "안뜰",
  // SF
  "space station": "우주 정거장", "spaceship interior": "우주선 내부",
  "cockpit": "조종석", "control room": "제어실",
  "planet": "행성", "asteroid": "소행성", "nebula": "성운",
};

const MOOD_KO: Record<string, string> = {
  "dimly lit": "어둑한", "dim": "어둑한",
  "warm": "따뜻한", "cold": "차가운", "cool": "서늘한",
  "bright": "밝은", "harsh": "강렬한", "soft": "부드러운",
  "dramatic": "극적인", "tense": "긴장된", "eerie": "으스스한",
  "peaceful": "평화로운", "serene": "고요한", "ominous": "불길한",
  "melancholic": "우울한", "nostalgic": "향수어린", "dreamy": "몽환적인",
  "gritty": "거친", "sterile": "차갑고 무균한", "chaotic": "혼돈의",
  "ethereal": "신비로운", "oppressive": "압도적인", "desolate": "황량한",
  "vibrant": "활기찬", "somber": "침울한", "mysterious": "신비한",
  "neon": "네온빛", "golden": "황금빛", "moonlit": "달빛 아래",
  "sunlit": "햇살 속", "foggy": "안개 낀", "stormy": "폭풍우의",
  "cinematic": "영화적인", "photorealistic": "사실적인",
};

// 범용 동작/행위 (인물 + 사물 + 자연현상)
const ACTION_KO: Record<string, string> = {
  // 인물 행동
  "walking": "걷는", "running": "달리는", "sitting": "앉아있는",
  "standing": "서있는", "lying": "누워있는", "kneeling": "무릎 꿇은",
  "reaching": "손을 뻗는", "grabbing": "움켜잡는", "holding": "잡고 있는",
  "dropping": "떨어뜨리는", "throwing": "던지는", "catching": "잡는",
  "looking": "바라보는", "staring": "응시하는", "turning": "돌아보는",
  "crying": "우는", "laughing": "웃는", "screaming": "비명 지르는",
  "whispering": "속삭이는", "breathing": "숨쉬는", "trembling": "떨리는",
  "fighting": "싸우는", "fleeing": "도망치는", "hiding": "숨는",
  "opening": "여는", "closing": "닫는", "climbing": "오르는",
  "falling": "떨어지는", "jumping": "뛰는", "dancing": "춤추는",
  "eating": "먹는", "drinking": "마시는", "sleeping": "자는",
  "reading": "읽는", "writing": "쓰는", "typing": "타이핑하는",
  "driving": "운전하는", "flying": "나는", "swimming": "수영하는",
  // 사물/현상
  "revealing": "드러내는", "approaching": "다가가는",
  "spinning": "회전하는", "moving": "움직이는", "emerging": "나타나는",
  "emphasized": "강조되는", "visible": "보이는", "unresolved": "미해결된",
  "increasing": "점점 빨라지는", "fading": "사라지는", "flickering": "깜빡이는",
  "shattering": "깨지는", "melting": "녹는", "growing": "커지는",
  "spreading": "퍼지는", "collapsing": "무너지는", "exploding": "폭발하는",
  "rising": "솟아오르는", "sinking": "가라앉는", "swirling": "소용돌이치는",
  "pulsing": "맥동하는", "dripping": "뚝뚝 떨어지는", "flowing": "흐르는",
  "cracking": "갈라지는", "blooming": "피어나는", "dissolving": "녹아내리는",
};

// ── 인물/캐릭터 키워드 ──
const CHARACTER_KO: Record<string, string> = {
  "woman": "여자", "man": "남자", "girl": "소녀", "boy": "소년",
  "child": "아이", "elderly": "노인", "old man": "노인", "old woman": "할머니",
  "figure": "인물", "silhouette": "실루엣", "shadow": "그림자",
  "character": "인물", "protagonist": "주인공", "person": "사람",
  "patient": "환자", "doctor": "의사", "nurse": "간호사",
  "soldier": "군인", "warrior": "전사", "knight": "기사",
  "king": "왕", "queen": "여왕", "priest": "성직자",
  "detective": "탐정", "scientist": "과학자", "artist": "예술가",
  "stranger": "낯선 사람", "crowd": "군중", "couple": "커플",
  "hands": "손", "face": "얼굴", "eyes": "눈", "fingers": "손가락",
  "body": "몸", "arm": "팔", "legs": "다리", "head": "머리",
  "back": "등", "shoulders": "어깨", "lips": "입술", "tears": "눈물",
  "blood": "피", "sweat": "땀", "breath": "숨결",
};

// ── Role-based Korean fallback templates ──

const ROLE_FALLBACK_KO: Record<string, string> = {
  establish: "장면 도입 — 전체 공간이 보임",
  transition: "시점 전환 — 새로운 각도",
  develop: "액션 전개 — 주체가 움직임",
  insert: "디테일 강조 — 오브젝트 클로즈업",
  peak: "절정 — 가장 강렬한 순간",
  resolve: "마무리 — 긴장 유지 또는 해소",
  opening: "도입",
  building: "전개",
  climax: "절정",
  falling: "하강",
};

// ═══════════════════════════════════════════════════════════════════
// Layer 2: Multi-word extraction helper
// ═══════════════════════════════════════════════════════════════════

function extractFirst(lower: string, dict: Record<string, string>): string {
  // 길이 순 정렬 (긴 구 먼저 매칭)
  const sorted = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  for (const [en, ko] of sorted) {
    if (lower.includes(en)) return ko;
  }
  return "";
}

function extractAll(lower: string, dict: Record<string, string>, max: number): string[] {
  const sorted = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  const found: string[] = [];
  for (const [en, ko] of sorted) {
    if (lower.includes(en) && !found.includes(ko)) {
      found.push(ko);
      if (found.length >= max) break;
    }
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════
// Main function
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a short Korean summary from a single cleaned English shot prompt.
 *
 * 3-layer strategy:
 * 1. Keyword mapping — framing, camera, mood, objects, places, actions, characters
 * 2. Noun/verb extraction — 프롬프트에서 핵심어를 뽑아 구성
 * 3. Role-based fallback — 최후 수단
 */
export function generateShotSummaryKo(
  prompt: string,
  role?: string,
): string {
  if (!prompt || prompt.trim().length === 0) {
    return ROLE_FALLBACK_KO[role || "establish"] || "장면";
  }

  const lower = prompt.toLowerCase();
  const parts: string[] = [];

  // ── Layer 1: Keyword extraction ──
  const framingKo = extractFirst(lower, FRAMING_KO);
  const cameraKo = extractFirst(lower, CAMERA_KO);
  const moodKo = extractFirst(lower, MOOD_KO);
  const actionKo = extractFirst(lower, ACTION_KO);
  const characterKo = extractFirst(lower, CHARACTER_KO);
  const objectsFound = extractAll(lower, OBJECT_KO, 2);
  const placeKo = extractFirst(lower, PLACE_KO);

  // ── Build summary from extracted keywords ──

  // 분위기
  if (moodKo) parts.push(moodKo);

  // 장소 + 프레이밍
  if (placeKo && (framingKo === "전경" || framingKo === "초광각" || framingKo === "공중")) {
    parts.push(`${placeKo} ${framingKo}`);
  } else if (placeKo) {
    parts.push(placeKo);
  }

  // 인물/캐릭터 + 행동
  if (characterKo && actionKo) {
    parts.push(`${characterKo}가 ${actionKo}`);
  } else if (characterKo) {
    if (framingKo === "클로즈업" || framingKo === "극접사" || framingKo === "밀착") {
      parts.push(`${characterKo} ${framingKo}`);
    } else {
      parts.push(characterKo);
    }
  } else if (objectsFound.length > 0) {
    const objStr = objectsFound.join(", ");
    if (actionKo) {
      parts.push(`${objStr}이 ${actionKo}`);
    } else if (cameraKo) {
      parts.push(`${objStr}을 ${cameraKo} 훑어봄`);
    } else if (framingKo === "클로즈업" || framingKo === "극접사" || framingKo === "밀착") {
      parts.push(`${objStr} ${framingKo}`);
    } else {
      parts.push(objStr);
    }
  } else if (actionKo) {
    parts.push(actionKo);
  }

  // 카메라만 있고 다른 정보 없을 때
  if (parts.length === 0 && cameraKo) {
    parts.push(`${cameraKo} ${framingKo || "장면"}`);
  } else if (parts.length === 0 && framingKo) {
    parts.push(`${framingKo} 장면`);
  }

  // Layer 1 결과가 있으면 반환
  if (parts.length > 0) {
    return parts.join(", ").slice(0, 200);
  }

  // ── Layer 2: 핵심 구절 추출 (키워드 매칭 실패 시) ──
  // shot size/angle/camera 지시 제거 후 핵심 내용 추출
  const stripped = prompt
    .replace(/^(extreme\s+)?(wide|medium|close[- ]?up|tight|overhead|establishing|aerial|full)\s+(shot\s+)?/gi, "")
    .replace(/^(eye-level|high angle|low angle|dutch angle|bird's eye|over-the-shoulder|pov)\s*,?\s*/gi, "")
    .replace(/^(slow\s+)?(push[- ]?in|pull[- ]?back|pan|tilt|orbit|tracking|dolly|drift|crane|handheld|steadicam|zoom\s+in|zoom\s+out)\s*,?\s*/gi, "")
    .replace(/^(slow|fast|gentle|subtle)\s+(pan|tilt|push|pull|drift|zoom)\s*,?\s*/gi, "")
    .trim();

  if (stripped.length > 8) {
    // 첫 2개 구절 추출 (마침표/콤마 기준)
    const clauses = stripped.split(/[.,;]/)
      .map(c => c.trim())
      .filter(c => c.length > 5)
      .slice(0, 2);

    if (clauses.length > 0) {
      // 각 구절에서 핵심 단어 6개까지
      const summary = clauses
        .map(c => c.split(/\s+/).slice(0, 6).join(" "))
        .join(", ");
      const roleFallback = ROLE_FALLBACK_KO[role || "establish"]?.split(" — ")[0] || "";
      return roleFallback
        ? `${roleFallback} — ${summary}`.slice(0, 200)
        : summary.slice(0, 200);
    }
  }

  // ── Layer 3: Role-based fallback ──
  return ROLE_FALLBACK_KO[role || "establish"] || "장면";
}

/**
 * Generate Korean summaries for an array of multi-shot prompts.
 * Returns the same-length array of summary strings.
 *
 * @deprecated Prefer generateSummariesFromNormalizedPayload() which derives
 * summaries from the authoritative NormalizedVeoPayload.model_params.multi_prompt.
 * This legacy function is kept for backward compatibility with call sites
 * that have not yet migrated to the normalized payload flow.
 */
export function generateMultiShotSummariesKo(
  shots: MultiShotPrompt[],
): Array<{ index: number; duration: string; summaryKo: string }> {
  return shots.map((shot) => ({
    index: shot.index,
    duration: shot.duration,
    summaryKo: generateShotSummaryKo(shot.prompt, shot.role),
  }));
}

/**
 * Generate Korean summaries from normalized multi_prompt entries.
 * Used by VideoGenerationPanel for summary display.
 */
export function generateSummariesFromNormalizedMultiPrompt(
  entries: NormalizedMultiPromptEntry[],
): Array<{ index: number; duration: string; summaryKo: string }> {
  return entries.map((entry) => ({
    index: entry.index,
    duration: entry.duration,
    summaryKo: generateShotSummaryKo(entry.prompt),
  }));
}

/**
 * Generate Korean summaries from the authoritative NormalizedVeoPayload.
 * Derives summaries from model_params.multi_prompt, which is what VEO actually receives.
 */
export function generateSummariesFromNormalizedPayload(
  payload: NormalizedVeoPayload,
): Array<{ index: number; duration: string; summaryKo: string }> {
  const multiPrompt = payload.model_params?.multi_prompt;
  if (!multiPrompt || multiPrompt.length === 0) {
    return [{
      index: 1,
      duration: payload.duration,
      summaryKo: generateShotSummaryKo(payload.prompt),
    }];
  }

  return multiPrompt.map((entry) => ({
    index: entry.index,
    duration: entry.duration,
    summaryKo: generateShotSummaryKo(entry.prompt),
  }));
}
