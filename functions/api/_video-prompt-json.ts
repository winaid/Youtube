/**
 * _video-prompt-json.ts — 서버사이드 영상 프롬프트 JSON 유틸리티
 *
 * generate-cuts.ts, generate-video.ts에서 import하여 사용.
 * src/lib/video-prompt-json.ts와 동일 타입/렌더러 (서버용 복제)
 *
 * 렌더링 원칙:
 * - 비시각 메타태그(REVEALED/WITHHELD/END_HOOK 등) = 내부 planning 전용, 최종 프롬프트 제외
 * - characterRef 비어있으면 캐릭터 관련 필드 일체 생략
 * - 모든 출력은 VEO가 실제 렌더링할 수 있는 시각 정보만
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
  // ── 감독 시각 DNA (VEO까지 직접 전달) ──
  directorColorHint?: string;   // 감독 색감 팔레트 (예: "jewel tones emerald crimson gold")
  directorCameraHint?: string;  // 감독 카메라 철학 (예: "symmetry compositions, slow lateral tracking")
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
  /** 감독 시각 DNA — extend 프롬프트에서 스타일 일관성 유지용 */
  directorStyleHint?: string;
}

// ─── Dialogue / Quoted Text Stripping ─────────────────────────────────────────
// VEO가 인용문/대사를 자막으로 렌더링하는 것을 방지

/** 인용문(따옴표, 꺽쇠 등)과 한글 텍스트를 프롬프트에서 제거 */
function stripDialogueAndKorean(text: string): string {
  let cleaned = text;
  // 1. 따옴표로 둘러싸인 대사 제거: 'text', "text", "text", 「text」, 『text』
  cleaned = cleaned.replace(/[""\u201C\u201D][^""\u201C\u201D]*[""\u201C\u201D]/g, "");
  cleaned = cleaned.replace(/['''][^''']*[''']/g, "");
  cleaned = cleaned.replace(/「[^」]*」/g, "");
  cleaned = cleaned.replace(/『[^』]*』/g, "");
  // 2. "says/whispers/shouts + quoted text" 패턴 → 인용 부분만 제거, 뒤 텍스트 보존
  cleaned = cleaned.replace(/\b(says?|whispers?|shouts?|yells?|murmurs?|mutters?|exclaims?)\s*["'""'「『][^"'""'」』]*["'""'」』]/gi, "speaks");
  // 3. 한글 텍스트 제거 (VEO가 자막으로 렌더링함)
  cleaned = cleaned.replace(/[\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF]+/g, "");
  // 4. 정리: 중복 공백/구두점
  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/[,.]\s*[,.]/g, ",").replace(/\.\s*\./g, ".").trim();
  return cleaned;
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

// ─── Provider 렌더러 ──────────────────────────────────────────────────────────

export function renderPromptFromJson(json: VideoPromptJson): string {
  const parts: string[] = [];
  parts.push(`${json.shotSize} shot, ${json.cameraAngle}`);
  if (json.cameraMovement && json.cameraMovement !== "static") {
    const movement = json.cameraMovement.replace(/\s*\([^)]*\)\s*/g, "").trim();
    parts.push(movement);
  }
  // Location establishing — 장소 정체성 즉시 인식
  if (json.locationCue) parts.push(json.locationCue);
  // Situation evidence — 상황 시각적 증거
  if (json.situationCue) parts.push(json.situationCue);
  // Character
  if (json.characterRef) parts.push(json.characterRef);
  // Emotional anchor
  if (json.emotionalAnchor) parts.push(json.emotionalAnchor);
  if (json.subjectAction) parts.push(json.subjectAction);
  if (json.bodySignal) parts.push(json.bodySignal);
  if (json.moodLighting) parts.push(json.moodLighting);
  // Director Visual DNA — 감독 색감/카메라가 VEO까지 직접 전달
  if (json.directorColorHint) parts.push(json.directorColorHint);
  if (json.directorCameraHint) parts.push(json.directorCameraHint);
  // Temporal beats
  if (json.timingBeat) parts.push(json.timingBeat);
  const cleanSuffix = json.styleSuffix
    .replace(/,?\s*with natural diegetic sound and ambient audio/g, "")
    .trim();
  parts.push(cleanSuffix);
  enforceCinematicRealismMedium(parts, json);
  return stripDialogueAndKorean(parts.filter(Boolean).join(". "));
}

export function renderExtendPromptFromJson(json: ExtendPromptJson): string {
  const parts: string[] = [];
  parts.push(`Continuing from ${json.prevSceneEnd.shotType} scene`);
  parts.push(`${json.newShot.shotSize} shot, ${json.newShot.cameraAngle}`);
  if (json.newShot.cameraMovement) parts.push(json.newShot.cameraMovement);
  if (json.characterRef) parts.push(json.characterRef);
  parts.push(json.newAction);
  if (json.behavioralShift) parts.push(json.behavioralShift);
  // Director Visual DNA — 감독의 색감/조명/무드를 extend에서도 유지
  if (json.directorStyleHint) parts.push(json.directorStyleHint);
  const cleanSuffix = json.styleSuffix
    .replace(/,?\s*with natural diegetic sound and ambient audio/g, "")
    .trim();
  parts.push(cleanSuffix);
  return stripDialogueAndKorean(parts.filter(Boolean).join(". "));
}
