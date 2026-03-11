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
  // ── 즉시 인식 가능성 (Instant Readability) 3-pillar ──
  /** 장소 정체성 시각 단서 */
  locationCue?: string;       // e.g. "dental chair and overhead lamp"
  /** 상황 증거 시각 단서 */
  situationCue?: string;      // e.g. "empty waiting room, no patients"
  /** 감정/갈등 앵커 */
  emotionalAnchor?: string;   // e.g. "doctor slumps alone at desk"
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
  // Instant Readability 3-pillar
  locationCue?: string;
  situationCue?: string;
  emotionalAnchor?: string;
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
    locationCue:        input.locationCue || "",
    situationCue:       input.situationCue || "",
    emotionalAnchor:    input.emotionalAnchor || "",
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
  sceneType?: string;
  sceneTypeLabel?: string;
}

/** 비시각 메타태그 패턴 — 최종 렌더링 전에 제거해야 하는 내부 planning 언어 */
const NON_VISUAL_META_TAGS = /\b(REVEALED|WITHHELD|END_HOOK|SUBJECT_ACROSS_SCENE|SUBJECT_BLOCKING|TRANSITION_FROM_PREV|ACTION_BEAT|BODY_SIGNAL|CAMERA_PROGRESSION|SHOT_SIZE|CAMERA_ANGLE|SCENE BEATS|NEWLY REVEALED|STILL WITHHELD|NEW SCENE OPENS|PREV SCENE ENDS|NEW ACTION|BEHAVIORAL SHIFT)\s*:/i;

/** 추상 조명 표현 패턴 — 구체적 광원 정보 없이 분위기만 서술 */
const ABSTRACT_LIGHTING = /^(dramatic|moody|atmospheric|cinematic|dark|bright|warm|cool|soft|harsh)\s+(light|lighting|mood|atmosphere)$/i;

/** 정적 행동 패턴 — 캐릭터가 아무것도 안 하는 상태 */
const STATIC_ACTION = /\b(stands?\s|standing\s|motionless|remains\s|stationary|facing\s+camera|watches?\s+quietly)\b/i;

/** 텍스트 유도 오브젝트 — 'no readable text'와 충돌하는 표현 */
const TEXT_GENERATING_OBJECTS = /\b(sign|signs|signage|faded sign|dusty sign|signboard|placard|billboard|marquee|banner text|lettered|lettering|readable|legible)\b/i;

// ── 씬 타입 감지 (클라이언트 측) ─────────────────────────────────────────────
type SceneType = "character" | "environment" | "object-detail" | "map-graphic" | "transition-abstract";

function detectSceneTypeLocal(
  renderedPrompt: string,
  json: VideoPromptJson,
  opts?: { shotCategory?: string; characterRole?: string },
): SceneType {
  if (opts?.shotCategory) {
    const map: Record<string, SceneType> = {
      "character-driven": "character",
      "environment": "environment",
      "object-detail": "object-detail",
      "map-graphic": "map-graphic",
      "transition-atmosphere": "transition-abstract",
    };
    if (map[opts.shotCategory]) return map[opts.shotCategory];
  }
  if (opts?.characterRole === "absent" || !json.characterRef) {
    if (/\b(map|terrain|topograph|satellite|aerial|bird.?s?\s+eye|globe|continent|border|region)\b/i.test(renderedPrompt)) return "map-graphic";
    if (/\b(landscape|cityscape|skyline|mountain|forest|ocean|panoram)\b/i.test(renderedPrompt)) return "environment";
    if (/\b(close.?up|macro|detail|object|artifact)\b/i.test(renderedPrompt)) return "object-detail";
    return "transition-abstract";
  }
  return "character";
}

// ── 씬 타입별 워드카운트 범위 ────────────────────────────────────────────────
const WORD_RANGE: Record<SceneType, { min: number; max: number }> = {
  "character": { min: 80, max: 350 },
  "environment": { min: 60, max: 300 },
  "object-detail": { min: 50, max: 250 },
  "map-graphic": { min: 40, max: 250 },
  "transition-abstract": { min: 40, max: 200 },
};

// ── 씬 타입별 라벨 ──────────────────────────────────────────────────────────
const SCENE_TYPE_LABEL_KO: Record<SceneType, string> = {
  "character": "캐릭터 씬",
  "environment": "환경/풍경 씬",
  "object-detail": "오브젝트/디테일 씬",
  "map-graphic": "지도/인포그래픽 씬",
  "transition-abstract": "전환/추상 씬",
};

/**
 * 최종 렌더링된 프롬프트에 대한 품질 체크리스트 생성
 * 씬 타입에 따라 다른 기준 적용
 */
export function generateQualityChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  opts?: { shotCategory?: string; characterRole?: string },
): QualityChecklist {
  const sceneType = detectSceneTypeLocal(renderedPrompt, json, opts);
  const range = WORD_RANGE[sceneType];

  // 씬 타입별 분기
  if (sceneType === "map-graphic") {
    return generateMapGraphicChecklist(renderedPrompt, json, sceneType, range);
  }
  if (sceneType === "environment") {
    return generateEnvironmentChecklist(renderedPrompt, json, sceneType, range);
  }
  if (sceneType === "object-detail") {
    return generateObjectDetailChecklist(renderedPrompt, json, sceneType, range);
  }
  if (sceneType === "transition-abstract") {
    return generateTransitionChecklist(renderedPrompt, json, sceneType, range);
  }
  // character (default)
  return generateCharacterChecklist(renderedPrompt, json, opts, range);
}

// ── 캐릭터 씬 체크리스트 ─────────────────────────────────────────────────────
function generateCharacterChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  opts: { shotCategory?: string; characterRole?: string } | undefined,
  range: { min: number; max: number },
): QualityChecklist {
  const items: QualityCheckItem[] = [];

  // 1. 비시각 메타태그 없는지
  items.push(checkNoMetaTags(renderedPrompt));

  // 2. 텍스트 유도 오브젝트 충돌
  items.push(checkNoTextObjects(renderedPrompt));

  // 3. 구체적 조명
  items.push(checkConcreteLighting(json.moodLighting || ""));

  // 4. 시간 진행
  items.push(checkTemporalBeats(renderedPrompt));

  // 5. 캐릭터 묘사 충분
  const charRef = json.characterRef || "";
  const hasDetailedChar = charRef.length >= 20 && /\b(hair|outfit|wearing|age|skin|build)\b/i.test(charRef);
  items.push({
    id: "character-description",
    label: "캐릭터 묘사 충분 (외형+의상+특징)",
    passed: hasDetailedChar,
    detail: !hasDetailedChar ? "캐릭터 외형 묘사가 부족 — hair, outfit, age, skin 등 필요" : undefined,
  });

  // 6. 정적 행동 없는지
  const hasStaticAction = STATIC_ACTION.test(renderedPrompt);
  items.push({
    id: "no-static-action",
    label: "정적 행동(stands/motionless) 없음",
    passed: !hasStaticAction,
    detail: hasStaticAction ? "standing/motionless 같은 정적 행동 발견" : undefined,
  });

  // 7. 시각 디테일 밀도
  items.push(checkVisualDetailDensity(renderedPrompt));

  // 8. 장소 정체성
  items.push(checkLocationIdentity(renderedPrompt));

  // 9. 상황 증거
  items.push(checkSituationEvidence(renderedPrompt));

  // 10. 감정 앵커
  const emotionalAnchors = [
    /\b(slump|slouch|lean|hunch|droop|sag|collapse)\b/i,
    /\b(grip|clench|squeeze|press|tap|drum|fidget)\b/i,
    /\b(sigh|exhale|breath|gasp|swallow|gulp)\b/i,
    /\b(stare|gaze|glance|look\s+away|avert|dart)\b/i,
    /\b(tremble|shake|shiver|quiver|twitch)\b/i,
    /\b(smile|grin|frown|scowl|grimace|wince)\b/i,
    /\b(turn\s+away|step\s+back|pull\s+back|reach|extend)\b/i,
    /\b(crumple|tear|drop|throw|push\s+aside)\b/i,
    /\b(pause|hesitate|freeze|stop|halt|falter)\b/i,
  ];
  const hasEmotionalAnchor = emotionalAnchors.some(p => p.test(renderedPrompt));
  items.push({
    id: "emotional-anchor",
    label: "감정/갈등 앵커 포함 (신체 행동)",
    passed: hasEmotionalAnchor,
    detail: !hasEmotionalAnchor ? "인물의 구체적 신체 행동이 없음 — slump/grip/sigh/stare 등" : undefined,
  });

  // 11. 시퀀스 비트
  items.push(checkSequenceBeats(renderedPrompt));

  // 12. 프롬프트 길이
  items.push(checkPromptLength(renderedPrompt, range));

  return { items, passCount: items.filter(i => i.passed).length, totalCount: items.length, sceneType: "character" as SceneType, sceneTypeLabel: SCENE_TYPE_LABEL_KO["character"] };
}

// ── 맵/인포그래픽 씬 체크리스트 ──────────────────────────────────────────────
function generateMapGraphicChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  sceneType: SceneType,
  range: { min: number; max: number },
): QualityChecklist {
  const items: QualityCheckItem[] = [];

  // 1. 비시각 메타태그
  items.push(checkNoMetaTags(renderedPrompt));

  // 2. 텍스트/라벨 요청 없음 (맵 씬에서 특히 중요)
  const hasTextRequest = /\b(text|label|labeled|caption|title|name|letter|word|number|digit|annotation|legend)\b/i.test(renderedPrompt);
  items.push({
    id: "no-text-labels",
    label: "텍스트/라벨 요청 없음 (Veo 텍스트 불가)",
    passed: !hasTextRequest,
    detail: hasTextRequest
      ? "지도에 텍스트/라벨 요청 → 대체: colored overlays, glowing boundaries, relief regions, icon markers, highlight zones"
      : undefined,
  });

  // 2-b. 사각형 아티팩트 유발 표현 없음 (sign/frame/panel/infographic 등)
  const rectArtifactPattern = /\b(sign|signboard|signpost|frame(?:d)?\s+(?:insert|object|panel)|panel[\s-]?like|infographic|overlay\s+(?:panel|box)|title\s+box|caption\s+box|text\s+box|UI[\s-]?panel|cartouche|plaque|country\s+names?)\b/i;
  const hasRectArtifact = rectArtifactPattern.test(renderedPrompt);
  items.push({
    id: "no-rect-artifacts",
    label: "사각형 아티팩트 유발 표현 없음",
    passed: !hasRectArtifact,
    detail: hasRectArtifact
      ? "sign/frame/panel/infographic/plaque/cartouche 감지 → 모델이 의도하지 않은 사각형 박스를 생성할 위험. 제거 또는 안전한 표현으로 교체 필요"
      : undefined,
  });

  // 3. 지형 디테일
  const terrainPatterns = [
    /\b(mountain|peak|ridge|hill|valley|canyon|plateau|cliff)\b/i,
    /\b(river|stream|lake|ocean|sea|coast|shore|bay|harbor)\b/i,
    /\b(forest|woodland|jungle|grassland|prairie|field|plain)\b/i,
    /\b(desert|tundra|glacier|marsh|swamp|wetland)\b/i,
    /\b(terrain|topograph|elevation|contour|relief|slope)\b/i,
    /\b(border|boundary|region|territory|province|district)\b/i,
  ];
  const terrainCount = terrainPatterns.filter(p => p.test(renderedPrompt)).length;
  items.push({
    id: "terrain-detail",
    label: "지형/지리 디테일 충분 (terrain 2+)",
    passed: terrainCount >= 2,
    detail: terrainCount < 2 ? `지형 요소 ${terrainCount}/6 — 산/강/해안/평원 등 구체적 지형 추가 필요` : undefined,
  });

  // 4. 시각적 구분 (텍스트 대체 수단)
  const visualAlternatives = [
    /\b(color|colored|colour|hue|tint|shade)\b/i,
    /\b(overlay|highlight|glow|pulse|pulsing|shimmer)\b/i,
    /\b(boundary|border|outline|contour|edge)\b/i,
    /\b(relief|shading|gradient|pattern|texture)\b/i,
    /\b(icon|marker|symbol|indicator|dot|pin)\b/i,
    /\b(zone|area|region|sector|layer)\b/i,
  ];
  const altCount = visualAlternatives.filter(p => p.test(renderedPrompt)).length;
  items.push({
    id: "visual-distinction",
    label: "지역 구분 시각 수단 포함 (color/overlay/boundary)",
    passed: altCount >= 2,
    detail: altCount < 2 ? `시각 구분 수단 ${altCount}/6 — colored overlays, glowing boundaries, relief shading 등 추가 필요` : undefined,
  });

  // 5. 구체적 조명
  items.push(checkConcreteLighting(json.moodLighting || ""));

  // 6. 카메라/모션 적절성
  const hasAerialCamera = /\b(aerial|flyover|bird.?s?\s+eye|overhead|drone|satellite|zoom|pan\s+across|sweep)\b/i.test(renderedPrompt);
  items.push({
    id: "aerial-camera",
    label: "항공/조감 카메라 움직임 포함",
    passed: hasAerialCamera,
    detail: !hasAerialCamera ? "지도 씬에 적합한 카메라: aerial flyover, bird's eye, slow zoom, pan across terrain 등" : undefined,
  });

  // 7. 시간 진행
  items.push(checkTemporalBeats(renderedPrompt));

  // 8. 시퀀스 비트
  items.push(checkSequenceBeats(renderedPrompt));

  // 9. 프롬프트 길이
  items.push(checkPromptLength(renderedPrompt, range));

  return { items, passCount: items.filter(i => i.passed).length, totalCount: items.length, sceneType, sceneTypeLabel: SCENE_TYPE_LABEL_KO[sceneType] };
}

// ── 환경/풍경 씬 체크리스트 ──────────────────────────────────────────────────
function generateEnvironmentChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  sceneType: SceneType,
  range: { min: number; max: number },
): QualityChecklist {
  const items: QualityCheckItem[] = [];

  // 1. 비시각 메타태그
  items.push(checkNoMetaTags(renderedPrompt));

  // 2. 텍스트 유도 오브젝트
  items.push(checkNoTextObjects(renderedPrompt));

  // 3. 공간 레이어링 (전경/중경/후경)
  const hasLayering = /\b(foreground|midground|background|depth|layer|plane)\b/i.test(renderedPrompt);
  items.push({
    id: "spatial-layering",
    label: "공간 레이어링 (전경/중경/후경)",
    passed: hasLayering,
    detail: !hasLayering ? "환경 씬에 foreground/midground/background 깊이 표현 필요" : undefined,
  });

  // 4. 구체적 조명 + 대기 효과
  items.push(checkConcreteLighting(json.moodLighting || ""));

  // 5. 환경 모션 (바람, 물, 빛 변화)
  const envMotion = /\b(wind|sway|wave|ripple|flow|drift|flutter|rustle|rain|snow|cloud|fog|mist|light\s+shift)\b/i.test(renderedPrompt);
  items.push({
    id: "env-motion",
    label: "자연 환경 모션 포함 (wind/water/light)",
    passed: envMotion,
    detail: !envMotion ? "환경 씬에 자연 모션 추가 필요 — wind, ripple, cloud drift, light shift 등" : undefined,
  });

  // 6. 장소 정체성
  items.push(checkLocationIdentity(renderedPrompt));

  // 7. 상황 증거
  items.push(checkSituationEvidence(renderedPrompt));

  // 8. 환경 감정 앵커
  const envAnchors = [
    /\b(flickering|dying|fading|dimming|brightening)\b/i,
    /\b(closing|opening|swinging|creaking|settling)\b/i,
    /\b(withered|wilting|blooming|growing|decaying)\b/i,
    /\b(empty|abandoned|deserted|silent|peaceful|chaotic)\b/i,
  ];
  const hasEnvAnchor = envAnchors.some(p => p.test(renderedPrompt));
  items.push({
    id: "env-emotional-anchor",
    label: "환경 감정 앵커 포함 (분위기 변화)",
    passed: hasEnvAnchor,
    detail: !hasEnvAnchor ? "환경 변화를 통한 감정 앵커 — flickering/wilting/empty/settling 등" : undefined,
  });

  // 9. 시간 진행
  items.push(checkTemporalBeats(renderedPrompt));

  // 10. 시퀀스 비트
  items.push(checkSequenceBeats(renderedPrompt));

  // 11. 프롬프트 길이
  items.push(checkPromptLength(renderedPrompt, range));

  return { items, passCount: items.filter(i => i.passed).length, totalCount: items.length, sceneType, sceneTypeLabel: SCENE_TYPE_LABEL_KO[sceneType] };
}

// ── 오브젝트/디테일 씬 체크리스트 ────────────────────────────────────────────
function generateObjectDetailChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  sceneType: SceneType,
  range: { min: number; max: number },
): QualityChecklist {
  const items: QualityCheckItem[] = [];

  items.push(checkNoMetaTags(renderedPrompt));
  items.push(checkNoTextObjects(renderedPrompt));

  // 오브젝트 구체성
  const hasObjectDetail = /\b(texture|material|surface|grain|polish|metal|wood|glass|ceramic|fabric|leather|paper|plastic|stone)\b/i.test(renderedPrompt);
  items.push({
    id: "object-material",
    label: "오브젝트 재질/표면 묘사 포함",
    passed: hasObjectDetail,
    detail: !hasObjectDetail ? "구체적 재질 표현 필요 — texture, material, surface, metal, wood, glass 등" : undefined,
  });

  // 클로즈업 카메라
  const hasCloseCamera = /\b(close.?up|macro|rack\s+focus|shallow\s+depth|dolly\s+around|reveal|detail\s+shot)\b/i.test(renderedPrompt);
  items.push({
    id: "close-camera",
    label: "디테일 카메라 기법 (macro/rack focus)",
    passed: hasCloseCamera,
    detail: !hasCloseCamera ? "디테일 씬에 적합한 카메라: close-up, macro, rack focus, dolly around 등" : undefined,
  });

  items.push(checkConcreteLighting(json.moodLighting || ""));
  items.push(checkTemporalBeats(renderedPrompt));
  items.push(checkSequenceBeats(renderedPrompt));
  items.push(checkPromptLength(renderedPrompt, range));

  return { items, passCount: items.filter(i => i.passed).length, totalCount: items.length, sceneType, sceneTypeLabel: SCENE_TYPE_LABEL_KO[sceneType] };
}

// ── 전환/추상 씬 체크리스트 ──────────────────────────────────────────────────
function generateTransitionChecklist(
  renderedPrompt: string,
  json: VideoPromptJson,
  sceneType: SceneType,
  range: { min: number; max: number },
): QualityChecklist {
  const items: QualityCheckItem[] = [];

  items.push(checkNoMetaTags(renderedPrompt));

  // 시각 컨셉 명확성
  const hasVisualConcept = /\b(fade|dissolve|morph|transform|shift|transition|blur|swirl|particle|abstract|pattern)\b/i.test(renderedPrompt);
  items.push({
    id: "visual-concept",
    label: "시각 컨셉 명확 (전환/변형 방식)",
    passed: hasVisualConcept,
    detail: !hasVisualConcept ? "전환 씬에 구체적 시각 컨셉 필요 — fade, dissolve, morph, particle 등" : undefined,
  });

  // 색감/무드
  const hasColorPalette = /\b(color|palette|hue|tone|warm|cool|monochrome|gradient|saturated|desaturated)\b/i.test(renderedPrompt);
  items.push({
    id: "color-palette",
    label: "색감/무드 팔레트 지정",
    passed: hasColorPalette,
    detail: !hasColorPalette ? "전환 씬에 구체적 색감 지정 필요" : undefined,
  });

  items.push(checkConcreteLighting(json.moodLighting || ""));
  items.push(checkTemporalBeats(renderedPrompt));
  items.push(checkSequenceBeats(renderedPrompt));
  items.push(checkPromptLength(renderedPrompt, range));

  return { items, passCount: items.filter(i => i.passed).length, totalCount: items.length, sceneType, sceneTypeLabel: SCENE_TYPE_LABEL_KO[sceneType] };
}

// ── 공통 체크 함수들 ─────────────────────────────────────────────────────────

function checkNoMetaTags(prompt: string): QualityCheckItem {
  const has = NON_VISUAL_META_TAGS.test(prompt);
  return { id: "no-meta-tags", label: "비시각 메타태그 없음", passed: !has, detail: has ? "내부 planning 태그가 최종 프롬프트에 남아있음" : undefined };
}

function checkNoTextObjects(prompt: string): QualityCheckItem {
  const has = TEXT_GENERATING_OBJECTS.test(prompt);
  return { id: "no-text-object-conflict", label: "텍스트 유도 오브젝트 없음", passed: !has, detail: has ? "sign/signboard/lettered 등이 'no text'와 충돌" : undefined };
}

function checkConcreteLighting(lightingText: string): QualityCheckItem {
  const hasAbstractOnly = ABSTRACT_LIGHTING.test(lightingText.trim());
  const hasLightSource = /\b(light|lamp|sun|moon|neon|fluorescent|candle|fire|window|bulb|glow|spill|beam)\b/i.test(lightingText);
  const hasDirection = /\b(from|through|above|below|left|right|behind|overhead|side|rim|back|upper|lower)\b/i.test(lightingText);
  const hasQuality = /\b(soft|harsh|diffused|sharp|warm|cool|cold|pale|bright|dim|weak|flickering|steady|dappled)\b/i.test(lightingText);
  const passed = hasLightSource && hasDirection && !hasAbstractOnly;
  return {
    id: "concrete-lighting",
    label: "구체적 광원(source+direction+quality) 포함",
    passed,
    detail: !passed ? `조명: "${lightingText}" — source(${hasLightSource ? "✓" : "✗"}) + direction(${hasDirection ? "✓" : "✗"}) + quality(${hasQuality ? "✓" : "✗"})` : undefined,
  };
}

function checkTemporalBeats(prompt: string): QualityCheckItem {
  const has = /\d+s[-–]?\d+s/.test(prompt) || /first|then|finally/i.test(prompt);
  return { id: "visual-progression", label: "시간 진행(temporal beat) 포함", passed: has, detail: !has ? "0s-2s: ... 형태의 시간 비트가 없음" : undefined };
}

function checkSequenceBeats(prompt: string): QualityCheckItem {
  const beats = prompt.match(/\d+s[-–]\d+s/g) || [];
  const has = beats.length >= 2;
  return { id: "sequence-beats", label: "시퀀스 비트 구조 (2+ temporal beats)", passed: has, detail: !has ? `시간 비트 ${beats.length}개 — 최소 2개 필요` : undefined };
}

function checkPromptLength(prompt: string, range: { min: number; max: number }): QualityCheckItem {
  const wc = prompt.split(/\s+/).length;
  const good = wc >= range.min && wc <= range.max;
  return { id: "prompt-length", label: `프롬프트 길이 적정 (${range.min}-${range.max} words)`, passed: good, detail: !good ? `현재 ${wc} words` : undefined };
}

function checkVisualDetailDensity(prompt: string): QualityCheckItem {
  const patterns = [
    /\b(desk|table|chair|door|window|wall|floor|ceiling|shelf|counter|cabinet)\b/i,
    /\b(dust|crack|stain|scratch|worn|peeling|faded|rusty|weathered|chipped)\b/i,
    /\b(reflection|shadow|silhouette|haze|fog|mist|smoke|steam|condensation)\b/i,
    /\b(blinds|curtain|frame|tile|pipe|wire|cable|vent|grate|rail)\b/i,
    /\b(flickering|buzzing|dripping|swaying|creaking|settling)\b/i,
  ];
  const count = patterns.filter(p => p.test(prompt)).length;
  const good = count >= 2;
  return { id: "visual-detail-density", label: "시각 디테일 밀도 충분 (2+)", passed: good, detail: !good ? `환경 디테일 ${count}/5 — 구체적 오브젝트/질감/현상 추가 필요` : undefined };
}

function checkLocationIdentity(prompt: string): QualityCheckItem {
  const patterns = [
    /\b(desk|reception|counter|register|checkout)\b/i,
    /\b(chair|seat|bench|stool|sofa|couch)\b/i,
    /\b(kitchen|stove|oven|fridge|sink|pan|pot)\b/i,
    /\b(clinic|hospital|dental|medical|surgical)\b/i,
    /\b(classroom|blackboard|whiteboard|textbook|locker)\b/i,
    /\b(office|cubicle|monitor|keyboard|printer)\b/i,
    /\b(restaurant|menu|plate|glass|napkin)\b/i,
    /\b(street|sidewalk|crosswalk|storefront|awning)\b/i,
    /\b(car|vehicle|steering|dashboard|windshield)\b/i,
    /\b(bed|pillow|blanket|nightstand|bedroom)\b/i,
    /\b(waiting\s+room|lobby|hallway|corridor|entrance)\b/i,
    /\b(warehouse|factory|workshop|garage|studio|gym)\b/i,
  ];
  const has = patterns.some(p => p.test(prompt));
  return { id: "location-identity", label: "장소 정체성 오브젝트 (WHERE)", passed: has, detail: !has ? "장소를 즉시 인식할 수 있는 고유 오브젝트가 없음" : undefined };
}

function checkSituationEvidence(prompt: string): QualityCheckItem {
  const patterns = [
    /\b(empty|vacant|deserted|abandoned|unused|idle|untouched)\b/i,
    /\b(crowded|packed|busy|bustling|queue|waiting)\b/i,
    /\b(broken|damaged|cracked|torn|crumpled|shattered)\b/i,
    /\b(closed|locked|shut|sealed|blocked|barred)\b/i,
    /\b(off|dark|dim|unlit|flickering|dying|fading)\b/i,
    /\b(new|fresh|pristine|polished|gleaming|clean)\b/i,
    /\b(overflowing|stacked|piled|scattered|cluttered)\b/i,
    /\b(alone|solo|single|isolated|solitary)\b/i,
  ];
  const has = patterns.some(p => p.test(prompt));
  return { id: "situation-evidence", label: "상황 증거 포함 (WHAT)", passed: has, detail: !has ? "현재 상황을 보여주는 시각적 증거가 없음 — empty/crowded/broken/closed 등" : undefined };
}

/**
 * 렌더링된 프롬프트에서 비시각 메타태그를 정리하는 sanitizer
 * renderVeoPromptFromJson 호출 후 최종 정리용
 */
export function sanitizeRenderedPrompt(prompt: string): string {
  const s = prompt
    // ── 메타태그 키:값 형태 제거 (내부 planning 언어) ──
    .replace(/\b(REVEALED|WITHHELD|END_HOOK|SUBJECT_ACROSS_SCENE|SUBJECT_BLOCKING|TRANSITION_FROM_PREV|ACTION_BEAT|BODY_SIGNAL|CAMERA_PROGRESSION|SHOT_SIZE|CAMERA_ANGLE|SCENE BEATS|NEWLY REVEALED|STILL WITHHELD|NEW SCENE OPENS|PREV SCENE ENDS|NEW ACTION|BEHAVIORAL SHIFT)\s*:[^.]*\.\s*/gi, "")
    // 파이프 구분 메타 형식 제거: "SHOT_SIZE:WS | CAMERA_ANGLE:eye-level | ..."
    .replace(/\b(SHOT_SIZE|CAMERA_ANGLE|CAMERA_PROGRESSION|SUBJECT_ACROSS_SCENE|SUBJECT_BLOCKING)\s*:[^|.]*[|]/gi, "")
    // 남은 단독 메타 키:값 (마침표 없는 경우)
    .replace(/\b(SHOT_SIZE|CAMERA_ANGLE|CAMERA_PROGRESSION|SUBJECT_ACROSS_SCENE|REVEALED|WITHHELD|END_HOOK)\s*:[^,.;|]*[,;]?\s*/gi, "")
    // ── 텍스트 유도 오브젝트 → 텍스트 없는 대체물로 교체 ──
    .replace(/\b(dusty|faded|old|worn|weathered)\s+signs?\b/gi, "weathered wooden panel")
    .replace(/\bsignboards?\b/gi, "facade panel")
    .replace(/\bsignage\b/gi, "wall-mounted panel")
    .replace(/\b(clinic|shop|store|office)\s+signs?\b/gi, "$1 facade")
    .replace(/\b(neon|lit|glowing)\s+signs?\b/gi, "$1 tubes")
    .replace(/\bplacards?\b/gi, "posted panels")
    .replace(/\bbillboards?\b/gi, "blank wall surface")
    .replace(/\bmarquees?\b/gi, "awning overhang")
    // 일반적인 단독 "sign" (문맥상 간판 의미)
    .replace(/\ba\s+sign\b/gi, "a mounted panel")
    .replace(/\bthe\s+sign\b/gi, "the facade panel")
    // ── 추가 사각형 아티팩트 유발 표현 교체 ──
    .replace(/\b(labeled|labelled)\s+(region|area|zone|territory|country|province|district)s?\b/gi, "color-coded $2")
    .replace(/\bcountry\s+names?\b/gi, "colored territorial regions")
    .replace(/\btitle\s+box\b/gi, "")
    .replace(/\bcaption\s+box\b/gi, "")
    .replace(/\btext\s+box\b/gi, "")
    .replace(/\binfo\s*graphic\b/gi, "data visualization")
    .replace(/\bcartouche\b/gi, "ornamental border")
    .replace(/\bplaques?\b/gi, "mounted surfaces")
    // ── Newly visible / Camera angle 등 자연어 변환 잔여 제거 ──
    .replace(/\bNewly visible:\s*/gi, "")
    .replace(/\bCamera angle:\s*/gi, "")
    .replace(/\bSubject positioned\s*/gi, "")
    .replace(/\bAction:\s*/gi, "")
    .replace(/\bBody language:\s*/gi, "")
    .replace(/\bTransition:\s*/gi, "")
    .replace(/\bBehavior changes:\s*/gi, "")
    // ── 정리 ──
    .replace(/\.\s*\./g, ".")
    .replace(/\|\s*\./g, ".")
    .replace(/\|\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return s;
}

// ─── Veo 렌더러 ───────────────────────────────────────────────────────────────

/**
 * VideoPromptJson → Veo 3.1 호환 프롬프트 문자열
 *
 * 설계 원칙 (즉시 인식 가능성 우선):
 * 1. establishing → evidence → anchor 순서로 구성
 *    - BEAT1: 장소 정체성 (WHERE) — 보자마자 어디인지 인식
 *    - BEAT2: 상황 증거 (WHAT) — 무슨 상황인지 시각적 증거
 *    - BEAT3: 감정/갈등 앵커 (WHO/EMOTION) — 인물 행동으로 감정 전달
 * 2. 비시각 메타태그 제거, characterRef 비면 캐릭터 생략
 * 3. 조명은 source + direction + quality 구체화
 */
/**
 * Cinematic realism 모드에서 3D/CGI 오염을 감지하고 보정.
 * styleSuffix에 "cinematic realism"이 포함된 경우 자동 적용.
 */
function enforceCinematicRealismMedium(parts: string[], json: VideoPromptJson): void {
  const fullText = parts.join(" ") + " " + json.styleSuffix;
  const isCinematicRealism = /cinematic\s*realism/i.test(fullText);
  if (!isCinematicRealism) return;

  const isMapTerrain = /\b(map|terrain|topograph|relief|globe|continent|territorial|border|region)\b/i.test(fullText);

  // 1. 먼저 3D/CGI 표현 치환 (medium lock 삽입 전에 실행)
  for (let i = 0; i < parts.length; i++) {
    parts[i] = parts[i]
      .replace(/\b3D\s+topograph(?:ic)?\s+map\b/gi, "physical relief map surface with terrain contours")
      .replace(/\b3D\s+terrain\b/gi, "physical terrain surface")
      .replace(/\b3D\s+map\b/gi, "physical map surface")
      .replace(/\b3D\s+rendered?\b/gi, "cinematic")
      .replace(/\bCGI\s+(?:render|terrain|landscape)\b/gi, "cinematic physical surface")
      .replace(/\bgame[\s-]?map\b/gi, "physical map")
      .replace(/\bmini(?:ature)?\s+diorama\b/gi, "physical map surface")
      .replace(/\bglossy\s+(?:3D|render)\b/gi, "diffused natural surface")
      .replace(/\bplastic\s+(?:terrain|model|surface)\b/gi, "physical map surface");
  }

  // 2. 그 다음 매체 고정 문장 삽입 (치환 영향 안 받음)
  if (isMapTerrain) {
    parts.push("The image remains a physical map surface, not a real landscape and not a CGI render");
  }
}

export function renderVeoPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  const hasCharacter = !!json.characterRef;

  // 1. Shot/Camera — 씬 시작 기준
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);
  if (json.cameraMovement && json.cameraMovement !== "static") {
    parts.push(json.cameraMovement);
  }

  // 2. Location establishing — 장소 정체성이 즉시 인식되는 오브젝트
  if (json.locationCue) {
    parts.push(json.locationCue);
  }

  // 3. Situation evidence — 상황을 보여주는 시각적 증거
  if (json.situationCue) {
    parts.push(json.situationCue);
  }

  // 4. Character (있을 때만)
  if (hasCharacter) {
    parts.push(json.characterRef);
  }

  // 5. Emotional anchor + Scene action — 감정/갈등이 집약되는 행동
  if (json.emotionalAnchor) {
    parts.push(json.emotionalAnchor);
  }
  if (json.subjectAction) {
    parts.push(json.subjectAction);
  }

  // 6. Body signal (캐릭터 있을 때만)
  if (hasCharacter && json.bodySignal) {
    parts.push(json.bodySignal);
  }

  // 7. Lighting — 구체적 광원 정보
  if (json.moodLighting) {
    parts.push(json.moodLighting);
  }

  // 8. Temporal beats — establishing→evidence→anchor 시간 구조
  if (json.timingBeat) {
    parts.push(json.timingBeat);
  }

  // 9. Style suffix (no text/watermark 등)
  parts.push(json.styleSuffix);

  // 10. Cinematic realism medium enforcement — 3D/CGI drift 방지
  enforceCinematicRealismMedium(parts, json);

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

  // Cinematic realism medium enforcement — 3D/CGI drift 방지
  enforceCinematicRealismMedium(parts, json);

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
    locationCue:        "",
    situationCue:       "",
    emotionalAnchor:    "",
  };
}
