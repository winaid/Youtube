/**
 * critical-words.ts — positive/negative 충돌 검사용 핵심 단어 목록
 *
 * 이 단어들이 positive 프롬프트와 negative 프롬프트에 동시 존재하면
 * 반드시 한쪽에서 제거해야 한다.
 *
 * ⚠️ 수정 시 functions/api/_prompt-sanitizer.ts 의 동일 목록도 함께 갱신할 것.
 */
export const CRITICAL_CONFLICT_WORDS = [
  "watermark", "caption", "subtitle", "logo",
  "photorealistic", "cinematic", "text overlay",
  "blurry", "low quality",
] as const;
