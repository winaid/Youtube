/**
 * 스타일별 브라우저 기반 후처리 (CSS filter)
 *
 * 비용: 0원 — 모든 처리가 클라이언트 브라우저에서 실행됨.
 * 원리: CSS filter 속성으로 video 엘리먼트의 렌더링을 실시간 보정.
 *
 * 각 스타일의 VEO 출력 특성을 분석하여 필요한 보정을 매핑:
 * - 모노크롬 계열: grayscale 강제 (VEO가 컬러를 넣는 문제 해결)
 * - 빈티지/레트로: sepia + contrast로 필름 느낌 강화
 * - 수채화: saturation 부스트로 물감 느낌 강화
 * - 픽셀아트/레트로게임: contrast + 저채도로 CRT 느낌
 * - 안정적인 스타일: 필터 없음 (VEO 출력 그대로)
 */

export interface StylePostProcessConfig {
  /** CSS filter 문자열 (예: "grayscale(1) contrast(1.2)") */
  cssFilter: string;
  /** CSS mix-blend-mode (특수 효과용, 기본값 "normal") */
  mixBlendMode?: string;
  /** image-rendering 힌트 (pixel-art 등) */
  imageRendering?: string;
  /** 후처리 설명 (디버그/UI 표시용) */
  descriptionKo: string;
}

/**
 * 스타일별 CSS 후처리 매핑
 *
 * 규칙:
 * - full-supported (stabilityScore 4-5): 필터 없음 또는 미세 보정
 * - supported-with-warning (score 2-3): 적극적 보정
 * - experimental (score 1): 강한 보정
 */
const STYLE_POSTPROCESS: Record<string, StylePostProcessConfig> = {
  // ── 실사 ──
  "cinematic-realism": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — VEO 최적 스타일",
  },
  "docu-handheld": {
    cssFilter: "contrast(1.05) saturate(0.9)",
    descriptionKo: "다큐멘터리 톤 — 살짝 탈색",
  },
  "commercial-ad": {
    cssFilter: "saturate(1.15) contrast(1.05)",
    descriptionKo: "광고풍 — 색감 선명하게",
  },
  "vintage-film": {
    cssFilter: "sepia(0.3) contrast(1.1) brightness(0.95)",
    descriptionKo: "빈티지 — 세피아 톤 + 대비 강화",
  },
  "neon-noir": {
    cssFilter: "contrast(1.2) saturate(1.3) brightness(0.9)",
    descriptionKo: "네온누아르 — 고대비 + 채도 부스트",
  },
  "vhs-retro": {
    cssFilter: "sepia(0.15) contrast(1.1) saturate(0.85) brightness(1.05)",
    descriptionKo: "VHS 레트로 — 탈색 + 밝기 부스트",
  },
  "sf-futuristic": {
    cssFilter: "saturate(1.1) contrast(1.05) hue-rotate(-5deg)",
    descriptionKo: "SF — 쿨톤 시프트",
  },
  "gothic-horror": {
    cssFilter: "contrast(1.25) saturate(0.7) brightness(0.85)",
    descriptionKo: "고딕호러 — 어둡고 탈색",
  },

  // ── 2D 애니메이션 ──
  "tv-anime": {
    cssFilter: "saturate(1.15) contrast(1.05)",
    descriptionKo: "TV 애니메 — 채도 살짝 부스트",
  },
  "theatrical-anime": {
    cssFilter: "saturate(1.1) contrast(1.1)",
    descriptionKo: "극장판 애니메 — 대비 + 채도",
  },
  "storybook-anime": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — 안정적",
  },
  "painted-2d": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — 안정적",
  },
  "watercolor-animation": {
    cssFilter: "saturate(1.2) brightness(1.05)",
    descriptionKo: "수채화 애니 — 물감 색감 부스트",
  },
  "ink-drawing-anime": {
    cssFilter: "grayscale(0.6) contrast(1.3)",
    descriptionKo: "잉크드로잉 — 부분 탈색 + 고대비",
  },
  "webtoon-motion": {
    cssFilter: "saturate(1.1) contrast(1.1)",
    descriptionKo: "웹툰 — 선명한 색감",
  },
  "cutout-anime": {
    cssFilter: "contrast(1.15) saturate(1.1)",
    descriptionKo: "컷아웃 — 대비 강화",
  },

  // ── 3D 애니메이션 ──
  "pixar-style": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — VEO 최적 스타일",
  },
  "dreamworks-style": {
    cssFilter: "saturate(1.05) contrast(1.05)",
    descriptionKo: "드림웍스 — 미세 보정",
  },
  "stylized-3d": {
    cssFilter: "saturate(1.15) contrast(1.1)",
    descriptionKo: "스타일라이즈드 3D — 색감 부스트",
  },
  "semi-real-3d": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — 안정적",
  },
  "low-poly-3d": {
    cssFilter: "contrast(1.15) saturate(0.9)",
    descriptionKo: "로우폴리 — 대비 강화, 약간 탈색",
  },
  "miniature-3d": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — 안정적",
  },
  "game-cinematic-3d": {
    cssFilter: "contrast(1.1) saturate(1.05)",
    descriptionKo: "게임 시네마틱 — 미세 보정",
  },

  // ── 회화 ──
  "watercolor": {
    cssFilter: "saturate(1.25) brightness(1.05) contrast(0.95)",
    descriptionKo: "수채화 — 채도 부스트 + 밝기, 대비 낮춤",
  },
  "oil-painting": {
    cssFilter: "contrast(1.15) saturate(1.1)",
    descriptionKo: "유화 — 대비로 임파스토 질감 강화",
  },
  "gouache": {
    cssFilter: "saturate(1.15) contrast(1.1) brightness(0.98)",
    descriptionKo: "구아슈 — 불투명 매체감 강화",
  },
  "pastel": {
    cssFilter: "saturate(0.85) brightness(1.08) contrast(0.9)",
    descriptionKo: "파스텔 — 부드러운 탈색 + 밝기",
  },
  "east-asian-painting": {
    cssFilter: "saturate(0.6) contrast(1.15)",
    descriptionKo: "동양화 — 채도 낮춤 + 먹선 대비",
  },
  "ink-wash": {
    cssFilter: "grayscale(1) contrast(1.2)",
    descriptionKo: "수묵풍 — 완전 모노크롬 강제 + 대비",
  },
  "inkwash-painting": {
    cssFilter: "grayscale(1) contrast(1.15)",
    descriptionKo: "잉크워시 — 완전 모노크롬 강제",
  },
  "van-gogh-painted": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — VEO 최적 스타일",
  },
  "editorial-illustration": {
    cssFilter: "saturate(1.2) contrast(1.1)",
    descriptionKo: "에디토리얼 — 선명한 색감",
  },
  "storybook-illustration": {
    cssFilter: "none",
    descriptionKo: "보정 없음 — 안정적",
  },

  // ── 스톱모션/크래프트 ──
  "claymation": {
    cssFilter: "saturate(1.1) contrast(1.1)",
    descriptionKo: "클레이 — 색감 부스트",
  },
  "paper-collage": {
    cssFilter: "contrast(1.15) saturate(1.1)",
    descriptionKo: "페이퍼콜라주 — 대비 강화",
  },
  "felt-craft": {
    cssFilter: "saturate(1.2) brightness(1.05)",
    descriptionKo: "펠트 — 따뜻한 색감 부스트",
  },
  "wooden-puppet": {
    cssFilter: "sepia(0.1) contrast(1.1) saturate(0.95)",
    descriptionKo: "목각인형 — 나무 질감 강화",
  },
  "paper-puppet": {
    cssFilter: "contrast(1.2) brightness(1.05)",
    descriptionKo: "그림자극 — 고대비",
  },
  "miniature-diorama": {
    cssFilter: "saturate(1.15) contrast(1.05)",
    descriptionKo: "미니어처 — 미세 보정",
  },

  // ── 레트로 게임 ──
  "pixel-art": {
    cssFilter: "contrast(1.2) saturate(0.9)",
    imageRendering: "pixelated",
    descriptionKo: "픽셀아트 — 고대비 + 픽셀 보간 방지",
  },
  "16bit-jrpg": {
    cssFilter: "contrast(1.15) saturate(1.1)",
    imageRendering: "pixelated",
    descriptionKo: "16비트 — 고대비 + 픽셀 보간 방지",
  },
  "8bit-arcade": {
    cssFilter: "contrast(1.3) saturate(0.8)",
    imageRendering: "pixelated",
    descriptionKo: "8비트 — 강한 대비 + 탈색",
  },
  "ps1-lowpoly": {
    cssFilter: "contrast(1.1) saturate(0.85) brightness(0.95)",
    descriptionKo: "PS1 — 레트로 3D 톤",
  },
  "90s-game-cutscene": {
    cssFilter: "contrast(1.1) saturate(0.9)",
    descriptionKo: "90년대 게임 — 레트로 톤",
  },
  "visual-novel": {
    cssFilter: "saturate(1.15) contrast(1.05)",
    descriptionKo: "비주얼노벨 — 채도 부스트",
  },

  // ── 실험적 ──
  "rotoscoping": {
    cssFilter: "contrast(1.2) saturate(0.85)",
    descriptionKo: "로토스코핑 — 고대비 + 살짝 탈색",
  },
  "mixed-media-collage": {
    cssFilter: "contrast(1.15) saturate(1.1)",
    descriptionKo: "믹스드미디어 — 질감 대비 강화",
  },
  "live-paint-overlay": {
    cssFilter: "saturate(1.2) contrast(1.1)",
    descriptionKo: "라이브페인트 — 색감 부스트",
  },
  "docu-illustrated": {
    cssFilter: "contrast(1.1) saturate(0.9)",
    descriptionKo: "다큐일러스트 — 미세 보정",
  },
  "2d-3d-hybrid": {
    cssFilter: "contrast(1.1) saturate(1.05)",
    descriptionKo: "2D/3D 하이브리드 — 미세 보정",
  },
  "surreal-composite": {
    cssFilter: "contrast(1.1) saturate(1.15)",
    descriptionKo: "초현실 — 채도 부스트",
  },
};

/**
 * 스타일 ID에 대한 CSS 후처리 설정 반환.
 * 등록되지 않은 스타일은 필터 없음 (안전한 기본값).
 */
export function getStylePostProcess(styleId: string): StylePostProcessConfig {
  return STYLE_POSTPROCESS[styleId] ?? {
    cssFilter: "none",
    descriptionKo: "기본값 — 보정 없음",
  };
}

/**
 * video 엘리먼트에 적용할 인라인 스타일 객체 반환.
 * 기존 style 객체와 spread로 합쳐서 사용:
 *   style={{ maxHeight: "200px", ...getVideoFilterStyle("ink-wash") }}
 */
export function getVideoFilterStyle(styleId: string): React.CSSProperties {
  const config = getStylePostProcess(styleId);
  const style: React.CSSProperties = {};

  if (config.cssFilter && config.cssFilter !== "none") {
    style.filter = config.cssFilter;
  }
  if (config.mixBlendMode) {
    style.mixBlendMode = config.mixBlendMode as React.CSSProperties["mixBlendMode"];
  }
  if (config.imageRendering) {
    style.imageRendering = config.imageRendering as React.CSSProperties["imageRendering"];
  }

  return style;
}

/**
 * 후처리가 실제로 적용되는 스타일인지 확인 (필터가 none이 아닌 경우).
 */
export function hasActivePostProcess(styleId: string): boolean {
  const config = getStylePostProcess(styleId);
  return config.cssFilter !== "none" || !!config.imageRendering || !!config.mixBlendMode;
}
