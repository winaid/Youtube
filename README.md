# AI Cinematic Video Studio

AI 기반 영상 제작 스튜디오. 원고를 입력하면 감독 페르소나와 멀티샷 프로그레션을 적용하여 Kling AI용 구조화된 영상 시퀀스를 생성합니다.

## 핵심 개념

| 개념 | 설명 |
|------|------|
| **컷 (Cut/장면)** | 하나의 서사 단위. 8-15초 Kling 생성 단위. 전체 영상은 여러 컷으로 구성 |
| **멀티샷 (Multi-Shot)** | 한 컷 안의 내부 샷. 프레이밍 변화로 리텐션 확보 (establish→develop→peak→resolve) |
| **변형 (Variant)** | 같은 컷의 다른 시각적 해석. 새 컷 추가가 아닌 대안 생성 |
| **감독 페르소나** | 시각 톤(카메라/조명/색감)에만 반영. 이야기 구조는 원고를 따름 |

## 핵심 규칙

- **0~5초 = micro (1~2컷)** | **6~9초 = 최소 3컷** | **10~15초 = 4~6컷** | **16초+ = shortform 생성 불가** (절대 규칙)
- 일반적인 범위는 **3-6컷**
- 각 컷(8-15초) 안에서 멀티샷 4-6개 권장 (리텐션 기반)
- "샷 추가"는 한 컷 내부의 멀티샷을 추가하는 것 (새 컷 추가가 아님)

## 아키텍처 (3-Layer 모델)

```
Layer 1: 총 런타임 → 컷 분할 (sequence-density.ts)
Layer 2: 컷 → 8-15초 Kling 세그먼트 (densifyCuts)
Layer 3: 세그먼트 내부 → 멀티샷 (multi-shot-planner.ts)
```

## 주요 흐름

```
원고 입력 → 컷 계획 (감독 페르소나 + 밀도 규칙)
  → Gemini API로 컷 생성 (/api/generate-cuts)
  → 멀티샷 자동 배정 (role progression)
  → 에디터 (CutCard + MultiShotEditor)
  → 검증 (Editor/Pre-submit/Server 3단계)
  → Kling API 제출
```

## 개발 환경

```bash
npm run dev     # 개발 서버 시작
npm run build   # 프로덕션 빌드
npm test        # 테스트 실행
```

http://localhost:3000 에서 확인.

## 환경 변수

- `GEMINI_API_KEY` — Gemini API 키 (컷 생성용)
- Kling API 관련 키는 서버 설정에서 관리

## 기술 스택

- Next.js (App Router)
- TypeScript
- Kling AI O3 모델
- Gemini API (컷 생성)
- Tailwind CSS + shadcn/ui

## 문서

- `docs/HANDOFF.md` — 제품 상세 핸드오프
- `docs/multishot-architecture.md` — 멀티샷 아키텍처
- `docs/developer-notes.md` — 개발자 가이드
- `docs/runtime-budget-and-operations.md` — 운영 문서
