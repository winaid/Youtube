# Product Handoff: Kling Cinematic Sequence Production Tool

## What This Is

A multi-shot-first cinematic video production tool built on top of Kling AI's O3 model family. It generates structured multi-shot video sequences — not isolated single-shot clips.

The core workflow: a user provides a story or scene description, the system plans a sequence of cuts, each cut is decomposed into retention-optimized shots with distinct roles, and the full batch is submitted to Kling for generation.

## What This Is Not

- A generic AI prompt playground
- A single-shot video generator with optional multi-shot
- A thin wrapper around a video API
- A tool that silently restructures user input behind the scenes

## Product Philosophy

**Retention over spectacle.** Every multi-shot sequence follows a retention-optimized role progression (establish → develop → peak → resolve). Shots are not arbitrary splits — each has a narrative purpose.

**Multi-shot is the default.** Any eligible clip (≥6s cinematic/environment/battle/montage, or ≥9s anything) starts as multi-shot. Users must explicitly opt into one-take if they want single-shot behavior.

**Structural honesty.** What the user sees in the editor is what gets sent to Kling. The export/preview shows the actual `multiShot[]` + `structuredSequence` payload, not a flattened prompt string.

**Two modes for two mindsets.** Studio Mode is for careful review. Batch Mode is for throughput. They enforce different levels of validation, and the user sees which mode they're in.

## Critical Terminology — 컷 vs 멀티샷

| 용어 | 의미 | 레이어 |
|------|------|--------|
| **컷 (Cut/장면)** | 하나의 서사 단위. 8-15초 Kling 생성 단위 | Layer 1-2 |
| **멀티샷 (Multi-Shot)** | 한 컷 안의 내부 프레이밍 변화. role progression 적용 | Layer 3 |
| **변형 (Variant)** | 같은 컷의 대안 시각적 해석. 새 컷 추가 아님 | — |

**주의:** UI에서 "샷 추가"는 새 컷을 추가하는 것이 아니라, 한 컷 내부의 멀티샷을 추가하는 것.

## Absolute Rules (절대 규칙)

1. **0~5초 = micro (1~2컷)** | **6~9초 = 최소 3컷** | **10~15초 = 4~6컷** | **16초+ = shortform 생성 불가**
2. 각 컷(8-15초) 내부의 멀티샷은 **3-6개 권장** (리텐션 기반)
3. **Kling 15초 상한: 모든 컷은 최대 15초**. generate-cuts에서 리듬 분배, density 보정, reconciliation 후에도 15초 초과 시 강제 클램핑 적용
4. 이 규칙은 추천/자동 조정/하드캡/예외 처리보다 우선
4. 최종 출력에서 6초 이상 영상이 1-2컷으로 확정되면 안 됨

## Release Status

V1 완성 단계. 핵심 파이프라인/프롬프트/규칙이 구현 완료되었으며, 브라우저 기반 실사용 검증 진행 중.

## Major Implemented Features

| Feature | Status |
|---------|--------|
| Multi-shot planning engine | Complete |
| Role-based shot progression | Complete |
| Studio vs Batch validation | Complete |
| Submission-time auto-repair | Complete |
| Runtime budget (300s/batch) | Complete |
| Intentional one-take exception | Complete |
| Server-side enforcement & repair | Complete |
| Unsupported-model messaging | Complete |
| Job recovery & history | Complete |
| Export JSON with `multiShot[]` | Complete |
| Payload preview (3-tier) | Complete |
| Duration reconciliation (3-15s) | Complete |
| Editorial persona system | Complete |
| Narration pipeline | Complete |
| Quality verification pipeline | Complete |
| Auto-retry with negative strengthening | Complete |
| Director web search (googleSearchRetrieval) | Complete |
| Hybrid director recommendation (local + web) | Complete |

## Director Search & Recommendation

감독 검색/추천은 **실시간 웹 확장 하이브리드** 모드로 동작한다.

### 캐시 정책
- **캐시를 의도적으로 도입하지 않았다.** 결과 재사용, KV 저장, TTL 설계, 입력 정규화 캐시 키 생성 전부 없다.
- 매 호출마다 Gemini API를 새로 호출한다. 이는 결과의 정직성과 실시간성을 우선한 의도적 설계다.
- 속도 문제는 구조 개선과 공통 유틸 분리로 대응한다.

### 파이프라인
- **검색 (`/api/search-director`)**: Gemini + `googleSearchRetrieval` 도구를 사용한 실제 웹 검색. grounding metadata가 있으면 `grounded: true`로 표시, 없으면 `grounded: false`로 모델 지식 기반임을 명시.
- **추천 (`/api/recommend-director`)**: 3단계 파이프라인.
  1. Stage 1: 로컬 감독 풀에서 Gemini 매칭 (규칙 기반 사전 추출 + Gemini 분석)
  2. Stage 2: **항상** 웹 검색으로 외부 후보 확장 — 로컬 결과 강도와 무관. localWeak 게이트 완전 제거.
  3. Stage 3: 로컬 + 웹 결과 병합, 중복 제거 (공통 유틸 사용), grounding 품질 점수 계산

### grounding 품질 평가
단순 `grounded: boolean`이 아닌 정량 점수 (0-100). 평가 기준:
- source 개수 (0개=0점, 3+개=30점)
- source 도메인 다양성 (같은 도메인 반복 시 감점)
- source 제목/URL과 감독명·작품명의 관련성 (0-35점)
- 로컬 데이터와 웹 데이터의 상호 보강 여부 (+10점)
- 라벨: strong (70+) / moderate (40-69) / weak (1-39) / none (0)

### UI 라벨
- `grounded=true` + strong/moderate: "웹 검색 기반 추천 감독" + 신뢰도 점수
- `grounded=true` + weak: "웹 검색 기반 추천 감독" + "낮은 신뢰도" 경고
- `grounded=false`: "모델 지식 기반 추천 감독"
- source 없는 결과에 "웹 검색 결과" 라벨 사용 금지

### 외부 감독 잔존 보장 전략
외부(웹) 감독 후보가 0명으로 사라지는 문제를 구조적으로 방지:

1. **영문 전용 웹 검색 쿼리**: 한글 장르/무드를 영문으로 변환하여 Google Search Retrieval API 400 에러 방지.
   - `로맨스` → `romance`, `SF` → `sci-fi`, `차가운` → `cold` 등
2. **웹 검색 실패 시 모델 폴백**: 웹 검색이 400/500 에러를 반환하면, `googleSearchRetrieval` 없이 모델 지식만으로 재시도.
3. **중복 전멸 시 재시도**: 1차 웹 결과가 전부 로컬 중복으로 제거되면, 제외 목록을 강화한 2차 프롬프트로 재시도 (temperature 0.5로 상향).
4. **프롬프트 강화**: 영문명+한글명 쌍으로 제외 조건 명시, 별칭/우회 추천 금지, 지역 다양성 요구 (최소 2개 지역), 유명 감독 쏠림 방지.

### 중복 제거 기준
- **영문 이름**: 정규화(lowercase + 공백/하이픈 제거) 후 완전 일치 또는 부분 일치 (짧은 쪽 5자 이상 + 긴 쪽 길이의 60% 이상).
  - "Park" vs "Park Chan-wook" → false (4자 < 5자 최소)
  - "Miyazaki" vs "Miyazaki Hayao" → true (8자 ≥ 5자, 8/13 = 61%)
- **한글 이름**: 완전 일치만 허용. 한글은 2-4자가 풀네임이므로 부분 일치 위험.
  - "박" vs "박찬욱" → false (다른 사람일 수 있음)
  - "봉준호" vs "봉준호" → true
- 웹 결과 내부 중복도 제거 (같은 감독이 2번 반환되는 경우)

### fallback 동작 (6가지 구분)
| 상황 | 처리 | 디버그 정보 |
|------|------|------------|
| 웹 검색 성공 + 외부 후보 충분 | 정상 반환 | `attemptedWebSearch: true, webSearchAcceptedCount > 0` |
| 웹 검색 성공 + 후보 전부 중복 제거 | **2차 재시도** (강화된 제외 조건) | `webSearchRetryReason, webSearchAttemptCount: 2` |
| 웹 검색 성공 + 관련성 낮아 제거 | 사유 기록 | `webSearchRejectionReasons` |
| 웹 검색 실패 (400/500) | **모델 지식 폴백** | `webSearchProvider: "model-fallback (web failed 400)"` |
| 웹 검색 성공 + grounding 품질 낮음 | 반환 + weak 라벨 | `groundingQuality.label: "weak"` |
| search-director는 되지만 recommend-director 외부 0 | 재시도 로직 적용 | `webSearchAttemptCount, webSearchRetryReason` |

### 캐시를 쓰지 않고 품질을 올린 방식
- 프롬프트 구조화 강화 (제외 조건 명시, 다양성 요구, 구체적 사유 요구)
- 영문 쿼리로 API 안정성 확보
- 실패 시 자동 폴백/재시도 (캐시가 아니라 구조적 안전장치)
- 중복 제거 정밀화 (과도한 제거 방지)
- 디버그 메타 강화로 문제 원인 즉시 파악 가능

### 공통 유틸 (`_director-shared.ts`)
search-director와 recommend-director의 중복 로직을 공통 모듈로 분리:
- `generateSlugId()` — 웹 감독 ID 생성
- `extractGroundingSources()` — grounding metadata에서 source 추출 및 정규화
- `computeGroundingQuality()` — grounding 품질 점수 계산 (0-100)
- `isSameDirector()` — 이름 유사도 기반 동일 인물 판정 (영문 60% 부분일치, 한글 완전일치)
- `buildLocalNameSet()` / `isLocalDuplicate()` — 이름 기반 중복 판정
- `clampFitScore()` / `ensureReason()` — fitScore/reason 정규화
- `isGenericReason()` — 추천 사유 품질 검증

## 이어 만들기 (Continuity Mode)

### 토글의 실제 의미
- **이어 만들기 ON**: 여러 클립을 하나의 연속된 영상처럼 만듦. 캐릭터 외모, 색감, 조명, 움직임 방향이 세그먼트 간 일관되게 유지됨
- **이어 만들기 OFF**: 각 컷이 독립적으로 생성됨. 프롬프트 수준의 약한 연속성만 존재

### continuity ON일 때 무엇이 연결되는가
1. **프롬프트 주입**: CHARACTER LOCK, VISUAL LOCK, CONTINUATION FROM, ENDING RULE, NARRATIVE POSITION 블록이 generate-cuts 프롬프트에 삽입
2. **continuitySegment 생성 (Producer)**: generate-cuts API가 continuityMode ON일 때 각 컷에 `continuitySegment` 부착
   - `segmentIndex`: 전체 흐름에서 현재 컷 위치
   - `startState`: 이전 컷의 endState 또는 상위 전달된 prevEndState에서 파생
   - `endState`: 현재 컷의 장면 설명/카메라/조명에서 파생 (다음 컷의 startState가 됨)
   - `isLastSegment`: 마지막 컷 여부
3. **continuitySegment → continuityMeta 변환 (Consumer)**: useVideoGeneration이 cut.continuitySegment를 읽어 continuityMeta로 변환, generate-video에 전달
4. **generate-video 프롬프트 주입**: continuityMeta의 prevEndState를 "[CONTINUATION]" 블록으로 프롬프트에 삽입
5. **Frame chaining** (autoLinkFirstFrame=true 기본값):
   - 우선순위: lastFrameBase64 캐시 → 비디오 캡처 → storyboard end → storyboard start → text-to-video
   - 각 컷 완료 시 마지막 프레임을 캡처하여 다음 컷의 firstFrame으로 전달

### Continuity 3-Layer 아키텍처

| 레이어 | 역할 | 실패 시 |
|--------|------|---------|
| **Frame chaining** | 시각적 시작 프레임 연결 (lastFrame → firstFrame) | storyboard/text fallback |
| **Plan-based continuity** | 내러티브/상태 전달 (sceneDescription 기반 startState) | 프롬프트 수준 연속성 |
| **Actual endState extraction** | Gemini 프레임 분석으로 실제 생성 결과 반영 | plan-based로 fallback |

- 3개 레이어가 동시에 작동하면 가장 강한 연속성
- Actual endState는 `/api/analyze-frame`으로 마지막 프레임을 Gemini Flash에 분석시킴
- 분석 결과는 다음 컷의 `continuitySegment.startState`를 실시간 업데이트
- 기존 autoMode 순차 생성 패턴(CUT 1 완료 → CUT 2 시작)에 통합

### submitContinuitySequence 상태
- `video-generation-core.ts`에 정의된 독립 orchestrator
- 현재는 직접 활성화하지 않음 — 기존 autoMode + Gemini 분석 통합이 더 안정적
- 향후 완전 독립 순차 파이프라인이 필요할 때 활성화 예정

### 나레이션 속도 옵션 (3단계)

| 속도 | 값 | chars/sec | 용도 |
|------|------|-----------|------|
| 느리게 | `"slow"` | 3.0 | 감성형, 다큐멘터리, 여백 있는 전달 |
| 기본 | `"natural"` | 4.0 | 일반적인 기본 템포 |
| 빠르게 | `"fast"` | 5.5 | 정보 밀도 높은 숏폼, 빠른 전달 |

- UI: InputPanel 하단 3버튼 토글 ("느리게" / "기본" / "빠르게")
- 값: `PromptInput.narrationSpeed` (`"slow"` | `"natural"` | `"fast"`)
- 기본값: `"natural"` (4자/초) — 기존 동작과 완전 호환
- 계산 영향:
  - `estimateNarrationRuntime()`: 속도별 chars/sec + visual breathing room 적용
  - `estimateNarrationDuration()`: baseReadingSec, rhetoricalPause, breathingRoom 모두 pace별 분기
  - `estimateRuntime()` (script-analyzer): speed 파라미터 반영
  - `analyzeScript()`: beats 스케일링 — slow=1.33x, fast=0.727x
- 실제 효과: slow는 natural 대비 약 30-40% 런타임 증가, fast는 약 25-30% 단축
- Visual breathing: slow 1.20x > natural 1.15x > fast 1.08x
- Rhetorical pause: slow 1.3x > natural 1.0x > fast 0.5x
4. **endState 전파** (submitContinuitySequence): 세그먼트 순차 생성 시 이전 세그먼트의 확정된 endState가 다음 세그먼트의 startState로 전파

### ON이어도 continuity가 약해질 수 있는 경우
- R2 버킷 미설정 → Scene Extension 불가 → IMAGE_TO_VIDEO fallback (연속성 60%)
- lastFrame 캡처 실패 (CORS, data: URI) → storyboard fallback
- storyboard도 없음 → TEXT_TO_VIDEO (연속성 0%)
- Kling 모델 편차로 캐릭터 외모가 변할 수 있음

### autoLinkFirstFrame 토글
- **VideoSettingsPanel**에 위치. 기본값 true
- ON: CUT N>1에서 이전 컷의 마지막 프레임을 다음 컷의 firstFrame으로 자동 연결
- OFF: frame chaining 비활성화. 각 컷이 storyboard 또는 text 기반으로 독립 생성
- `useVideoGeneration.ts`에서 `cfg.autoLinkFirstFrame`으로 읽혀 frame chaining 분기에 사용됨

### 디버그 메타에서 continuity 상태 보는 법
클라이언트 콘솔에서 `[CUT N] continuity debug` 로그 확인:
- `autoLinkFirstFrame`: frame chaining 활성화 여부
- `continuityFrameSource`: 실제 사용된 frame 소스 (lastFrameBase64_cached / video_capture / storyboard_end / storyboard_start / text_to_video_fallback / disabled_by_autoLinkFirstFrame)
- `hasFirstFrame`: firstFrame 존재 여부
- `hasPrevClip`: 이전 컷 존재 여부

### UI 구조 — 로컬 vs 외부 추천 분리
- **보유 감독 추천** (보라색 #787fff): 로컬 풀에서 매칭된 감독
- **외부 감독 탐색** (초록색 #22c55e): 웹 검색 또는 모델 지식 기반 새 감독
- 외부 추천 섹션은 웹 검색이 시도되면 **항상 표시** (0명이어도 이유 설명)
- 외부 후보 0명 시: 원시 결과 수, 중복 제거 수, 재시도 여부, 제거 사유를 표시
- grounded 여부, 신뢰도 점수, 소스 개수를 과장 없이 표시

### 환경변수
`GEMINI_API_KEY` (또는 `GEMINI_API_KEY_2` fallback) 필요.

## Architecture Overview

```
User Input (story/prompt)
    ↓
Cut Planning (segment-aware density, editorial persona)
    ↓
Per-Cut Multi-Shot Planning (multi-shot-planner.ts)
    ↓
Editor (CutCard + MultiShotEditor)
    ↓
Client Validation (multishot-validation.ts, final-payload-validator.ts)
    ↓
Submission (video-generation-core.ts → /api/generate-video)
    ↓
Server Enforcement (Studio: block invalid | Batch: auto-repair)
    ↓
Kling API (multiShot[] + structuredSequence)
    ↓
Polling (adaptive intervals, 5s → 30s)
    ↓
Recovery / History (video-job-store.ts → localStorage)
```

### Client-Server Split

**Client owns**: planning, editing, preview, client-side validation, export JSON.

**Server owns**: final model selection, prompt serialization, multi-shot policy enforcement, auto-repair (Batch), blocking (Studio), Kling API submission.

The client does not know the final resolved model. It passes `modelId: undefined` in repair calls and relies on the server for authoritative enforcement. This is intentional — the server runs `resolveModelForWorkflow()` and applies model-specific limits.

## Important Constraints

### Force Multi-Shot Rules

| Condition | Enforcement |
|-----------|-------------|
| ≥9s, any scene type | Multi-shot forced |
| ≥6s + cinematic_sequence / environment / character-driven / battle / montage | Multi-shot forced |
| <6s, or scene type not in forced set | Optional |
| `intentionalOneTake=true` | Bypasses all enforcement |

### Mode Behavior

| Behavior | Studio | Batch |
|----------|--------|-------|
| Missing forced multi-shot | Block (400 error) | Auto-repair |
| Extra validation (roles, variety) | Yes | No |
| Runtime budget warning | Shown | Shown |
| Auto-retry | User-initiated | Automated |

### Model Capabilities (O3)

| Model | Max Shots | Min Shot Duration | Multi-Shot |
|-------|-----------|-------------------|------------|
| kling-o3-text-to-video | 6 | 2s | Yes |
| kling-o3-image-to-video | 6 | 2s | Yes |
| kling-o3-reference-to-video | 6 | 2s | Yes |
| kling-o3-video-edit | 0 | — | No |
| kling-custom-element | 0 | — | No |

### Duration Limits

- Minimum: 3s
- Maximum: 15s
- Clips ≤3s: always single-shot (maxShots=0)
- Fallback: 8s when no duration info available

## Known Limitations

1. **Client repair has no model identity.** `prepareMultiShotPayload()` on the client cannot force-generate multi-shot because it doesn't know the resolved model. It preserves existing shots and defers new generation to the server.

2. **Server auto-repaired shots lack roles.** The Kling API's `KlingMultiShot` type only supports `{index, prompt, duration}`. Server-generated repair shots use the base prompt for all shots without role semantics. The client retains role-enriched state in the editor.

3. **Video-edit workflow scaffolded but not wired.** The `kling-o3-video-edit` model is registered in the capability system but has no UI path for video editing workflows.

4. **CutCard useEffect intentionally skips deps.** The auto-initialization effect for multi-shot excludes `onUpdate` and `cut.multiShot` from its dependency array (with eslint-disable) to prevent infinite update loops. This is a deliberate stability tradeoff. Content-aware split results are validated against recommended minimum shot count and fall back to generic role-based split if density is insufficient.

5. **`multiShotSummary` in sequence-assembler is debug-only.** Generated but not consumed by any user-facing UI component.

6. **localStorage job store has size limits.** Auto-cleanup at 100 jobs, hard fallback at quota exceeded (keeps 20 completed + all pending).

## Next Recommended Areas

1. **Server-side role propagation.** If Kling ever supports roles in their API, propagate client-side roles through to the provider payload.

2. **Video-edit workflow UI.** Wire the registered `kling-o3-video-edit` model to an editing interface.

3. **Batch split execution.** The system suggests splitting over-budget batches but doesn't auto-execute the split. Adding automatic batch splitting would complete the throughput story.

4. **Recovery UX for server-repaired jobs.** Currently users can infer server repair from `multiShotCount=0 + generationMode=batch`. An explicit "auto-repaired by server" indicator would improve clarity.

5. **v3 model fallback testing.** The capability registry includes v3 models as fallbacks, but the fallback path (O3 → v3 on 403) needs production validation.
