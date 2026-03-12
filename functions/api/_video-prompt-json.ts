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
  // ── 즉시 인식 가능성 (Instant Readability) 3-pillar ──
  locationCue?: string;       // 장소 정체성 시각 단서
  situationCue?: string;      // 상황 증거 시각 단서
  emotionalAnchor?: string;   // 감정/갈등 앵커
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

// ─── Cinematic Realism Medium Enforcement ─────────────────────────────────────

function enforceCinematicRealismMedium(parts: string[], json: VideoPromptJson): void {
  const fullText = parts.join(" ") + " " + json.styleSuffix;
  const isCinematicRealism = /cinematic\s*realism/i.test(fullText);
  if (!isCinematicRealism) return;

  const isMapTerrain = /\b(map|terrain|topograph|relief|globe|continent|territorial|border|region)\b/i.test(fullText);

  // 1. 먼저 3D/CGI 표현 치환
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

  // 2. 매체 고정 문장 삽입 (치환 후)
  if (isMapTerrain) {
    parts.push("The image remains a physical map surface, not a real landscape and not a CGI render");
  }
}

// ─── Veo 렌더러 (LEGACY — Veo 생성 경로 제거됨, Gemini QA 참조용으로만 유지) ───

/** @deprecated Veo 생성 경로 제거됨. Kling 전용으로 renderKlingPromptFromJson 사용. */
export function renderVeoPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  const hasCharacter = !!json.characterRef;

  // 1. Shot/Camera
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);
  if (json.cameraMovement && json.cameraMovement !== "static") {
    parts.push(json.cameraMovement);
  }

  // 2. Location establishing — 장소 즉시 인식
  if (json.locationCue) parts.push(json.locationCue);

  // 3. Situation evidence — 상황 시각적 증거
  if (json.situationCue) parts.push(json.situationCue);

  // 4. Character (있을 때만)
  if (hasCharacter) parts.push(json.characterRef);

  // 5. Emotional anchor + Scene action
  if (json.emotionalAnchor) parts.push(json.emotionalAnchor);
  if (json.subjectAction) parts.push(json.subjectAction);

  // 6. Body signal (캐릭터 있을 때만)
  if (hasCharacter && json.bodySignal) parts.push(json.bodySignal);

  // 7. Lighting
  if (json.moodLighting) parts.push(json.moodLighting);

  // 8. Temporal beats
  if (json.timingBeat) parts.push(json.timingBeat);

  // 9. Style suffix
  parts.push(json.styleSuffix);

  // 10. Cinematic realism medium enforcement — 3D/CGI drift 방지
  enforceCinematicRealismMedium(parts, json);

  return parts.filter(Boolean).join(". ");
}

/** @deprecated Veo 생성 경로 제거됨. */
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
  enforceCinematicRealismMedium(parts, json);
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
