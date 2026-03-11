/**
 * video-prompt-json.ts — JSON 기반 영상 프롬프트 구조
 *
 * 내부 source-of-truth = VideoPromptJson (구조화된 JSON)
 * Provider 어댑터가 최종 단계에서 JSON → string 렌더링:
 *   - renderVeoPromptFromJson()  → Veo 3.1 호환 프롬프트 문자열
 *   - renderKlingPromptFromJson() → Kling/EvoLink 호환 프롬프트 문자열
 */

// ─── VideoPromptJson 타입 ─────────────────────────────────────────────────────

export interface VideoPromptJson {
  /** 샷 크기 */
  shotSize: string;       // ECU | CU | MCU | MS | MLS | LS | WS | OTS | POV
  /** 카메라 앵글 */
  cameraAngle: string;    // eye-level | low-angle | high-angle | dutch | overhead | POV
  /** 카메라 움직임 + 동기 */
  cameraMovement: string; // e.g. "slow push-in (tension builds toward reveal)"
  /** 피사체 프레임 내 위치 */
  subjectBlocking: string; // e.g. "foreground center-frame"
  /** 피사체 행동 */
  subjectAction: string;  // 구체적 신체 동작 ≤15w
  /** 핵심 행동 비트 */
  actionBeat: string;     // 망설임/중단/follow-through 포함
  /** 신체 시그널 (감정 라벨 금지) */
  bodySignal: string;     // hand/gaze/posture/breath 묘사
  /** 이 프레임에서 새로 공개되는 시각 정보 */
  revealed: string;
  /** 프레임 밖에 보류되는 정보 */
  withheld: string;
  /** 시간 비트 템플릿 */
  timingBeat: string;     // e.g. "0s-2s: [start]. 2s-5s: [develop]. 5s-8s: [climax]"
  /** 이전 장면과의 전환 대비 */
  transitionFromPrev: string;
  /** 캐릭터 외형 (verbatim) */
  characterRef: string;   // 절대 수정 금지
  /** 조명/무드 */
  moodLighting: string;
  /** 스타일 접미사 */
  styleSuffix: string;    // veoStyle + directorStyle + aspect ratio + no text/watermark
}

/** Scene Extension용 프롬프트 JSON */
export interface ExtendPromptJson {
  /** 이전 장면 종료 상태 */
  prevSceneEnd: {
    shotType: string;
    subjectAction: string;
    bodySignal: string;
  };
  /** 전환 타입 */
  transition: string;
  /** 새로운 장면 */
  newShot: {
    shotSize: string;
    cameraAngle: string;
    cameraMovement: string;
  };
  /** 캐릭터 외형 */
  characterRef: string;
  /** 새 행동 */
  newAction: string;
  /** 행동 변화 (감정 라벨 금지) */
  behavioralShift: string;
  /** 새로 공개 */
  newlyRevealed: string;
  /** 보류 */
  stillWithheld: string;
  /** 시간 비트 */
  timingBeat: string;
  /** 스타일 접미사 */
  styleSuffix: string;
}

// ─── 빌더 ─────────────────────────────────────────────────────────────────────

export interface BuildVideoPromptJsonInput {
  shotType: string;
  cameraAngle?: string;
  cameraMovement: string;
  subjectBlocking?: string;
  subjectAction: string;
  actionBeat?: string;
  bodySignal?: string;
  revealed?: string;
  withheld?: string;
  timingBeat: string;
  transitionFromPrev?: string;
  characterRef: string;
  moodLighting: string;
  styleSuffix: string;
}

export function buildVideoPromptJson(input: BuildVideoPromptJsonInput): VideoPromptJson {
  return {
    shotSize:           input.shotType,
    cameraAngle:        input.cameraAngle || "eye-level",
    cameraMovement:     input.cameraMovement,
    subjectBlocking:    input.subjectBlocking || "subject center-frame mid-ground",
    subjectAction:      input.subjectAction,
    actionBeat:         input.actionBeat || input.subjectAction,
    bodySignal:         input.bodySignal || "",
    revealed:           input.revealed || "new visual layer",
    withheld:           input.withheld || "",
    timingBeat:         input.timingBeat,
    transitionFromPrev: input.transitionFromPrev || "",
    characterRef:       input.characterRef,
    moodLighting:       input.moodLighting,
    styleSuffix:        input.styleSuffix,
  };
}

export interface BuildExtendPromptJsonInput {
  prevShotType: string;
  prevSubjectAction: string;
  prevBodySignal?: string;
  transition?: string;
  newShotSize: string;
  newCameraAngle?: string;
  newCameraMovement: string;
  characterRef: string;
  newAction: string;
  behavioralShift?: string;
  newlyRevealed?: string;
  stillWithheld?: string;
  timingBeat: string;
  styleSuffix: string;
}

export function buildExtendPromptJson(input: BuildExtendPromptJsonInput): ExtendPromptJson {
  return {
    prevSceneEnd: {
      shotType:      input.prevShotType,
      subjectAction: input.prevSubjectAction,
      bodySignal:    input.prevBodySignal || "",
    },
    transition:      input.transition || "cut",
    newShot: {
      shotSize:      input.newShotSize,
      cameraAngle:   input.newCameraAngle || "eye-level",
      cameraMovement: input.newCameraMovement,
    },
    characterRef:    input.characterRef,
    newAction:       input.newAction,
    behavioralShift: input.behavioralShift || "",
    newlyRevealed:   input.newlyRevealed || "",
    stillWithheld:   input.stillWithheld || "",
    timingBeat:      input.timingBeat,
    styleSuffix:     input.styleSuffix,
  };
}

// ─── 검증 ─────────────────────────────────────────────────────────────────────

const VALID_SHOT_SIZES = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "OTS", "POV"];
const BANNED_EMOTION_LABELS = ["anxious", "nervous", "sad", "angry", "happy", "scared", "guilty", "relieved"];
const BANNED_ACTIONS = ["stands", "watches", "looks at camera", "faces forward"];

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateVideoPromptJson(json: VideoPromptJson): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // shotSize 검증
  if (!VALID_SHOT_SIZES.includes(json.shotSize)) {
    warnings.push(`shotSize "${json.shotSize}" is not standard (expected: ${VALID_SHOT_SIZES.join("|")})`);
  }

  // subjectAction 검증
  if (!json.subjectAction || json.subjectAction.trim().length === 0) {
    errors.push("subjectAction is empty");
  } else {
    const actionLower = json.subjectAction.toLowerCase();
    for (const banned of BANNED_ACTIONS) {
      if (actionLower.includes(banned)) {
        warnings.push(`subjectAction contains banned word "${banned}" — use concrete physical action`);
      }
    }
  }

  // bodySignal 감정 라벨 검증
  if (json.bodySignal) {
    const bsLower = json.bodySignal.toLowerCase();
    for (const label of BANNED_EMOTION_LABELS) {
      if (bsLower.includes(label)) {
        warnings.push(`bodySignal contains emotion label "${label}" — use body behavior only`);
      }
    }
  }

  // characterRef — 캐릭터 부재 씬에서는 빈 값 허용
  // (shotCategory=environment/object-detail/transition-atmosphere일 때)
  // 존재하지만 너무 짧은 경우만 경고
  if (json.characterRef && json.characterRef.trim().length > 0 && json.characterRef.trim().length < 5) {
    warnings.push("characterRef is very short — verify if intentional");
  }

  // cameraMovement 동기 확인
  if (json.cameraMovement && !json.cameraMovement.includes("(") && json.cameraMovement !== "static") {
    warnings.push("cameraMovement should include motivation in parentheses, e.g. 'slow push-in (tension builds)'");
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

// ─── 품질 점수 최적화 체크리스트 ─────────────────────────────────────────────

export interface QualityCheckItem {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface QualityChecklist {
  items: QualityCheckItem[];
  passCount: number;
  totalCount: number;
}

/** 비시각 메타태그 패턴 — 최종 렌더링 전에 제거해야 하는 내부 planning 언어 */
const NON_VISUAL_META_TAGS = /\b(REVEALED|WITHHELD|END_HOOK|SUBJECT_ACROSS_SCENE|SUBJECT_BLOCKING|TRANSITION_FROM_PREV|ACTION_BEAT|BODY_SIGNAL|CAMERA_PROGRESSION|SHOT_SIZE|CAMERA_ANGLE)\s*:/i;

/** 추상 조명 표현 패턴 — 구체적 광원 정보 없이 분위기만 서술 */
const ABSTRACT_LIGHTING = /^(dramatic|moody|atmospheric|cinematic|dark|bright|warm|cool|soft|harsh)\s+(light|lighting|mood|atmosphere)$/i;

/** 정적 행동 패턴 — 캐릭터가 아무것도 안 하는 상태 */
const STATIC_ACTION = /\b(stands?\s|standing\s|motionless|remains\s|stationary|facing\s+camera|watches?\s+quietly)\b/i;

/**
 * 최종 렌더링된 프롬프트에 대한 품질 체크리스트 생성
 * verify-prompt.ts 채점 기준에 맞춰 사전 검증
 */
export function generateQualityChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  opts?: { shotCategory?: string; characterRole?: string },
): QualityChecklist {
  const items: QualityCheckItem[] = [];
  const isCharacterless = !json.characterRef || opts?.characterRole === "absent";

  // 1. 캐릭터 없는 씬에 character placeholder가 없는지
  const hasUnneededChar = isCharacterless && /\b(character|person|figure|subject)\b/i.test(renderedPrompt);
  items.push({
    id: "no-char-placeholder",
    label: "캐릭터 없는 씬에 character placeholder 없음",
    passed: !hasUnneededChar,
    detail: hasUnneededChar ? "characterless 씬인데 character/person/figure 언급 발견" : undefined,
  });

  // 2. 비시각 메타태그 없는지
  const hasMetaTags = NON_VISUAL_META_TAGS.test(renderedPrompt);
  items.push({
    id: "no-meta-tags",
    label: "비시각 메타태그(REVEALED/WITHHELD 등) 없음",
    passed: !hasMetaTags,
    detail: hasMetaTags ? "내부 planning 태그가 최종 프롬프트에 남아있음" : undefined,
  });

  // 3. 구체적 조명 정보 있는지
  const lightingText = json.moodLighting || "";
  const hasAbstractOnly = ABSTRACT_LIGHTING.test(lightingText.trim());
  const hasConcreteLight = lightingText.length > 15 && !hasAbstractOnly;
  items.push({
    id: "concrete-lighting",
    label: "구체적 광원/방향/질감 포함",
    passed: hasConcreteLight,
    detail: !hasConcreteLight ? `조명: "${lightingText}" — 광원+방향+질감 필요` : undefined,
  });

  // 4. 씬 진행/카메라 움직임 있는지
  const hasTemporal = /\d+s[-–]?\d+s/.test(renderedPrompt) || /first|then|finally/i.test(renderedPrompt);
  items.push({
    id: "visual-progression",
    label: "시간 진행(temporal beat) 포함",
    passed: hasTemporal,
    detail: !hasTemporal ? "0s-2s: ... 형태의 시간 비트가 없음" : undefined,
  });

  // 5. 씬 타입과 프롬프트가 일치하는지
  const sceneTypeMatched = (() => {
    if (!opts?.shotCategory) return true;
    if (opts.shotCategory === "character-driven") return !!json.characterRef;
    if (opts.shotCategory === "environment" || opts.shotCategory === "transition-atmosphere") return !json.characterRef || json.characterRef === "";
    return true;
  })();
  items.push({
    id: "scene-type-match",
    label: "씬 타입과 프롬프트 일치",
    passed: sceneTypeMatched,
    detail: !sceneTypeMatched ? `shotCategory=${opts?.shotCategory}인데 characterRef 불일치` : undefined,
  });

  // 6. 정적 행동 없는지 (캐릭터 있는 경우)
  const hasStaticAction = !isCharacterless && STATIC_ACTION.test(renderedPrompt);
  items.push({
    id: "no-static-action",
    label: "정적 행동(stands/motionless) 없음",
    passed: !hasStaticAction,
    detail: hasStaticAction ? "standing/motionless 같은 정적 행동 발견" : undefined,
  });

  // 7. 프롬프트 길이 적정 (80~350 words)
  const wordCount = renderedPrompt.split(/\s+/).length;
  const goodLength = wordCount >= 80 && wordCount <= 350;
  items.push({
    id: "prompt-length",
    label: "프롬프트 길이 적정 (80-350 words)",
    passed: goodLength,
    detail: !goodLength ? `현재 ${wordCount} words` : undefined,
  });

  return {
    items,
    passCount: items.filter(i => i.passed).length,
    totalCount: items.length,
  };
}

/**
 * 렌더링된 프롬프트에서 비시각 메타태그를 정리하는 sanitizer
 * renderVeoPromptFromJson 호출 후 최종 정리용
 */
export function sanitizeRenderedPrompt(prompt: string): string {
  return prompt
    // 메타태그 키:값 형태 제거
    .replace(/\b(REVEALED|WITHHELD|END_HOOK|SUBJECT_ACROSS_SCENE|SUBJECT_BLOCKING|TRANSITION_FROM_PREV|ACTION_BEAT|BODY_SIGNAL)\s*:[^.]*\.\s*/gi, "")
    // 이중 마침표/공백 정리
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Veo 렌더러 ───────────────────────────────────────────────────────────────

/**
 * VideoPromptJson → Veo 3.1 호환 프롬프트 문자열
 *
 * 설계 원칙:
 * - 비시각 메타태그(REVEALED/WITHHELD/END_HOOK/SUBJECT_ACROSS_SCENE 등) 제거
 * - 모든 요소는 Veo가 실제로 렌더링할 수 있는 시각 정보만
 * - characterRef가 비어있으면 캐릭터 관련 필드 일체 생략
 * - 조명은 source + direction + quality 수준으로 구체화
 */
export function renderVeoPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  const hasCharacter = !!json.characterRef;

  // 1. Shot/Camera — 씬 시작 기준 + 진행
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);
  if (json.cameraMovement && json.cameraMovement !== "static") {
    parts.push(json.cameraMovement);
  }

  // 2. Character (있을 때만)
  if (hasCharacter) {
    parts.push(json.characterRef);
  }

  // 3. Scene action — 시각적 행동 arc (자연어)
  if (json.subjectAction) {
    parts.push(json.subjectAction);
  }

  // 4. Body signal (캐릭터 있을 때만)
  if (hasCharacter && json.bodySignal) {
    parts.push(json.bodySignal);
  }

  // 5. Lighting — 구체적 광원 정보
  if (json.moodLighting) {
    parts.push(json.moodLighting);
  }

  // 6. Temporal beats — 핵심 구조 (Veo가 시간 진행을 따라감)
  if (json.timingBeat) {
    parts.push(json.timingBeat);
  }

  // 7. Style suffix (no text/watermark 등)
  parts.push(json.styleSuffix);

  return parts.filter(Boolean).join(". ");
}

/**
 * ExtendPromptJson → Veo 3.1 Scene Extension 프롬프트 문자열
 */
export function renderVeoExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];

  // Previous scene context
  parts.push(`Continuing from ${json.prevSceneEnd.shotType} shot — ${json.prevSceneEnd.subjectAction}`);

  // Transition
  parts.push(`${json.transition} to`);

  // New scene
  parts.push(`${json.newShot.shotSize} shot, ${json.newShot.cameraAngle}`);
  if (json.newShot.cameraMovement && json.newShot.cameraMovement !== "static") {
    parts.push(json.newShot.cameraMovement);
  }

  // Character (있을 때만)
  if (json.characterRef) {
    parts.push(json.characterRef);
  }

  // Scene action
  parts.push(json.newAction);

  if (json.behavioralShift) {
    parts.push(json.behavioralShift);
  }

  // Timing
  if (json.timingBeat) {
    parts.push(json.timingBeat);
  }

  // Style suffix
  parts.push(json.styleSuffix);

  return parts.filter(Boolean).join(". ");
}

// ─── Kling 렌더러 ─────────────────────────────────────────────────────────────

/**
 * VideoPromptJson → Kling/EvoLink 호환 프롬프트 문자열
 * Kling은 더 간결한 프롬프트를 선호 — 핵심만 추출
 */
export function renderKlingPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];

  // Shot description (Kling은 태그 형식보다 자연어)
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);

  if (json.cameraMovement && json.cameraMovement !== "static") {
    // 동기 부분 제거 — Kling은 간결함 선호
    const movement = json.cameraMovement.replace(/\s*\([^)]*\)\s*/g, "").trim();
    parts.push(movement);
  }

  // Character (있을 때만) + scene action
  if (json.characterRef) {
    parts.push(json.characterRef);
  }
  parts.push(json.subjectAction);

  if (json.bodySignal) {
    parts.push(json.bodySignal);
  }

  // Mood/lighting
  if (json.moodLighting) {
    parts.push(json.moodLighting);
  }

  // Style (Kling은 no text/watermark 등 필수)
  // styleSuffix에서 Veo 전용 부분 제거
  const cleanSuffix = json.styleSuffix
    .replace(/,?\s*with natural diegetic sound and ambient audio/g, "")
    .trim();
  parts.push(cleanSuffix);

  return parts.filter(Boolean).join(". ");
}

/**
 * ExtendPromptJson → Kling extend 프롬프트 (간결 버전)
 */
export function renderKlingExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];

  // 이전 씬 컨텍스트 (간결하게)
  parts.push(`Continuing from ${json.prevSceneEnd.shotType} scene`);

  // 새 씬
  parts.push(`${json.newShot.shotSize} shot, ${json.newShot.cameraAngle}`);

  // Character (있을 때만) + scene action
  if (json.characterRef) {
    parts.push(json.characterRef);
  }
  parts.push(json.newAction);

  if (json.behavioralShift) {
    parts.push(json.behavioralShift);
  }

  // Style
  const cleanSuffix = json.styleSuffix
    .replace(/,?\s*with natural diegetic sound and ambient audio/g, "")
    .trim();
  parts.push(cleanSuffix);

  return parts.filter(Boolean).join(". ");
}

// ─── 레거시 string → JSON 파서 (기존 프롬프트 호환) ──────────────────────────

/**
 * 기존 string-based videoPrompt를 VideoPromptJson으로 파싱
 * 완벽하지 않지만 기존 데이터 호환용
 */
export function parseVideoPromptString(prompt: string): VideoPromptJson {
  const extract = (key: string): string => {
    const re = new RegExp(`${key}:([^.|]+)`, "i");
    const m = prompt.match(re);
    return m ? m[1].trim() : "";
  };

  return {
    shotSize:           extract("SHOT_SIZE") || "MS",
    cameraAngle:        extract("CAMERA_ANGLE") || "eye-level",
    cameraMovement:     extract("CAMERA_MOVEMENT") || "",
    subjectBlocking:    extract("SUBJECT_BLOCKING") || "",
    subjectAction:      extract("SUBJECT") || "",
    actionBeat:         extract("ACTION_BEAT") || "",
    bodySignal:         extract("BODY_SIGNAL") || "",
    revealed:           extract("REVEALED") || "",
    withheld:           extract("WITHHELD") || "",
    timingBeat:         "",
    transitionFromPrev: extract("TRANSITION_FROM_PREV") || "",
    characterRef:       "", // string에서 자동 추출 어려움
    moodLighting:       "",
    styleSuffix:        "",
  };
}
