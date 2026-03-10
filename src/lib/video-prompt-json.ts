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

// ─── Veo 렌더러 ───────────────────────────────────────────────────────────────

/**
 * VideoPromptJson → Veo 3.1 호환 프롬프트 문자열
 * Veo는 자연어 프롬프트를 선호 — 구조화된 필드를 영어 자연어로 연결
 */
export function renderVeoPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];

  // Shot/Camera 블록 — 씬 오프닝 기준
  parts.push(`SHOT_SIZE:${json.shotSize}`);
  parts.push(`CAMERA_ANGLE:${json.cameraAngle}`);
  parts.push(`CAMERA_PROGRESSION:${json.cameraMovement}`);

  // Character (있을 때만)
  if (json.characterRef) {
    parts.push(json.characterRef);
  }

  // Blocking
  parts.push(`SUBJECT_BLOCKING:${json.subjectBlocking}`);

  // Scene progression — 핵심: 씬 안에서 일어나는 행동 arc
  parts.push(`SUBJECT_ACROSS_SCENE:${json.subjectAction}`);

  if (json.bodySignal) {
    parts.push(`BODY_SIGNAL:${json.bodySignal}`);
  }

  // Reveal/Withhold
  if (json.revealed) {
    parts.push(`REVEALED:${json.revealed}`);
  }
  if (json.withheld) {
    parts.push(`WITHHELD:${json.withheld}`);
  }

  // Scene timing beats — 씬 내부 진행의 핵심 구조
  parts.push(json.timingBeat);

  // Transition
  if (json.transitionFromPrev) {
    parts.push(`TRANSITION_FROM_PREV:${json.transitionFromPrev}`);
  }

  // Style suffix
  parts.push(json.styleSuffix);

  return parts.filter(Boolean).join(". ");
}

/**
 * ExtendPromptJson → Veo 3.1 Scene Extension 프롬프트 문자열
 */
export function renderVeoExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];

  // Previous scene context
  parts.push(`PREV SCENE ENDS: ${json.prevSceneEnd.shotType} — subject was ${json.prevSceneEnd.subjectAction}`);
  if (json.prevSceneEnd.bodySignal) {
    parts.push(`body showed ${json.prevSceneEnd.bodySignal}`);
  }

  // Transition
  parts.push(`→ ${json.transition.toUpperCase()}`);

  // New scene
  parts.push(`NEW SCENE: SHOT_SIZE:${json.newShot.shotSize} | CAMERA_ANGLE:${json.newShot.cameraAngle} | CAMERA_PROGRESSION:${json.newShot.cameraMovement}`);

  // Character (있을 때만)
  if (json.characterRef) {
    parts.push(json.characterRef);
  }

  // Scene action
  parts.push(`SCENE ACTION: ${json.newAction}`);

  if (json.behavioralShift) {
    parts.push(`BEHAVIORAL SHIFT: ${json.behavioralShift}`);
  }

  if (json.newlyRevealed) {
    parts.push(`NEWLY REVEALED: ${json.newlyRevealed}`);
  }
  if (json.stillWithheld) {
    parts.push(`STILL WITHHELD: ${json.stillWithheld}`);
  }

  // Timing
  parts.push(json.timingBeat);

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
