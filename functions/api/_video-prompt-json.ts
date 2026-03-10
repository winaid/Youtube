/**
 * _video-prompt-json.ts — 서버사이드 영상 프롬프트 JSON 유틸리티
 *
 * generate-cuts.ts, generate-video.ts에서 import하여 사용.
 * src/lib/video-prompt-json.ts와 동일 타입/렌더러 (서버용 복제)
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
  revealed: string;
  withheld: string;
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
  newlyRevealed: string;
  stillWithheld: string;
  timingBeat: string;
  styleSuffix: string;
}

// ─── Veo 렌더러 ───────────────────────────────────────────────────────────────

export function renderVeoPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  parts.push(`SHOT_SIZE:${json.shotSize}`);
  parts.push(`CAMERA_ANGLE:${json.cameraAngle}`);
  parts.push(`CAMERA_PROGRESSION:${json.cameraMovement}`);
  if (json.characterRef) parts.push(json.characterRef);
  parts.push(`SUBJECT_BLOCKING:${json.subjectBlocking}`);
  parts.push(`SUBJECT_ACROSS_SCENE:${json.subjectAction}`);
  if (json.bodySignal) parts.push(`BODY_SIGNAL:${json.bodySignal}`);
  if (json.revealed) parts.push(`REVEALED:${json.revealed}`);
  if (json.withheld) parts.push(`WITHHELD:${json.withheld}`);
  parts.push(json.timingBeat);
  if (json.transitionFromPrev) parts.push(`TRANSITION_FROM_PREV:${json.transitionFromPrev}`);
  parts.push(json.styleSuffix);
  return parts.filter(Boolean).join(". ");
}

export function renderVeoExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];
  parts.push(`PREV SCENE ENDS: ${json.prevSceneEnd.shotType} — subject was ${json.prevSceneEnd.subjectAction}`);
  if (json.prevSceneEnd.bodySignal) parts.push(`body showed ${json.prevSceneEnd.bodySignal}`);
  parts.push(`→ ${json.transition.toUpperCase()}`);
  parts.push(`NEW SCENE: SHOT_SIZE:${json.newShot.shotSize} | CAMERA_ANGLE:${json.newShot.cameraAngle} | CAMERA_PROGRESSION:${json.newShot.cameraMovement}`);
  if (json.characterRef) parts.push(json.characterRef);
  parts.push(`SCENE ACTION: ${json.newAction}`);
  if (json.behavioralShift) parts.push(`BEHAVIORAL SHIFT: ${json.behavioralShift}`);
  if (json.newlyRevealed) parts.push(`NEWLY REVEALED: ${json.newlyRevealed}`);
  if (json.stillWithheld) parts.push(`STILL WITHHELD: ${json.stillWithheld}`);
  parts.push(json.timingBeat);
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
  parts.push(json.subjectAction);
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
