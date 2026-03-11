/**
 * _video-prompt-json.ts — 서버사이드 영상 프롬프트 JSON 유틸리티
 *
 * generate-cuts.ts, generate-video.ts에서 import하여 사용.
 * src/lib/video-prompt-json.ts와 동일 타입/렌더러 (서버용 복제)
 *
 * 렌더링 원칙:
 * - 비시각 메타태그(REVEALED/WITHHELD/END_HOOK 등) = 내부 planning 전용, 최종 프롬프트 제외
 * - characterRef 비어있으면 캐릭터 관련 필드 일체 생략
 * - 모든 출력은 Veo/Kling이 실제 렌더링할 수 있는 시각 정보만
 */

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface VideoPromptJson {
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  subjectBlocking: string;
  subjectAction: string;
  actionBeat: string;
  bodySignal: string;
  revealed: string;       // internal planning only — 렌더링에 포함하지 않음
  withheld: string;       // internal planning only — 렌더링에 포함하지 않음
  timingBeat: string;
  transitionFromPrev: string;
  characterRef: string;
  moodLighting: string;
  styleSuffix: string;
}

export interface ExtendPromptJson {
  prevSceneEnd: {
    shotType: string;
    subjectAction: string;
    bodySignal: string;
  };
  transition: string;
  newShot: {
    shotSize: string;
    cameraAngle: string;
    cameraMovement: string;
  };
  characterRef: string;
  newAction: string;
  behavioralShift: string;
  newlyRevealed: string;  // internal planning only
  stillWithheld: string;  // internal planning only
  timingBeat: string;
  styleSuffix: string;
}

// ─── Veo 렌더러 ───────────────────────────────────────────────────────────────

export function renderVeoPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  const hasCharacter = !!json.characterRef;

  // Shot/Camera
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);
  if (json.cameraMovement && json.cameraMovement !== "static") {
    parts.push(json.cameraMovement);
  }

  // Character (있을 때만)
  if (hasCharacter) parts.push(json.characterRef);

  // Scene action
  if (json.subjectAction) parts.push(json.subjectAction);

  // Body signal (캐릭터 있을 때만)
  if (hasCharacter && json.bodySignal) parts.push(json.bodySignal);

  // Lighting
  if (json.moodLighting) parts.push(json.moodLighting);

  // Temporal beats
  if (json.timingBeat) parts.push(json.timingBeat);

  // Style suffix
  parts.push(json.styleSuffix);

  return parts.filter(Boolean).join(". ");
}

export function renderVeoExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];

  parts.push(`Continuing from ${json.prevSceneEnd.shotType} shot — ${json.prevSceneEnd.subjectAction}`);
  parts.push(`${json.transition} to`);
  parts.push(`${json.newShot.shotSize} shot, ${json.newShot.cameraAngle}`);
  if (json.newShot.cameraMovement && json.newShot.cameraMovement !== "static") {
    parts.push(json.newShot.cameraMovement);
  }
  if (json.characterRef) parts.push(json.characterRef);
  parts.push(json.newAction);
  if (json.behavioralShift) parts.push(json.behavioralShift);
  if (json.timingBeat) parts.push(json.timingBeat);
  parts.push(json.styleSuffix);

  return parts.filter(Boolean).join(". ");
}

// ─── Kling 렌더러 ─────────────────────────────────────────────────────────────

export function renderKlingPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);
  if (json.cameraMovement && json.cameraMovement !== "static") {
    const movement = json.cameraMovement.replace(/\s*\([^)]*\)\s*/g, "").trim();
    parts.push(movement);
  }
  if (json.characterRef) parts.push(json.characterRef);
  if (json.subjectAction) parts.push(json.subjectAction);
  if (json.bodySignal) parts.push(json.bodySignal);
  if (json.moodLighting) parts.push(json.moodLighting);
  const cleanSuffix = json.styleSuffix
    .replace(/,?\s*with natural diegetic sound and ambient audio/g, "")
    .trim();
  parts.push(cleanSuffix);
  return parts.filter(Boolean).join(". ");
}

export function renderKlingExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];
  parts.push(`Continuing from ${json.prevSceneEnd.shotType} scene`);
  parts.push(`${json.newShot.shotSize} shot, ${json.newShot.cameraAngle}`);
  if (json.characterRef) parts.push(json.characterRef);
  parts.push(json.newAction);
  if (json.behavioralShift) parts.push(json.behavioralShift);
  const cleanSuffix = json.styleSuffix
    .replace(/,?\s*with natural diegetic sound and ambient audio/g, "")
    .trim();
  parts.push(cleanSuffix);
  return parts.filter(Boolean).join(". ");
}
