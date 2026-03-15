## S3 설계안 — Shot Role UI + Inline Editing + Validation Layer

### 1. Shot Card 데이터 모델

현재 `MultiShotPrompt`은 최소 필드만 보유:
```ts
{ index: number; prompt: string; duration: string }
```

**확장안 — `ShotCardModel`**:
```ts
interface ShotCardModel {
  index: number;           // 1-based 순차
  prompt: string;          // ≤512자
  duration: string;        // 초 (문자열) — Kling API 규격
  role: ShotRole;          // 역할 분류 (신규)
  cameraHint?: string;     // 카메라 힌트 (선택)
}

type ShotRole =
  | "establish"    // 시퀀스 도입 — 공간/시간 설정
  | "develop"      // 전개 — 행동/서사 진행
  | "peak"         // 절정 — 감정/액션 클라이맥스
  | "resolve"      // 해소 — 정리/여운
  | "insert"       // 삽입 — 디테일/오브젝트 컷
  | "transition";  // 전환 — 다음 시퀀스 브릿지
```

기존 `MultiShotPrompt`은 **하위 호환**:
- `role` 미지정 시 `index` 기반 자동 추론 (`index === 1 → establish`, `last → resolve`, 나머지 → `develop`)
- `cameraHint`는 선택 필드 — 없으면 프롬프트에서 카메라 정보를 파싱하지 않음

### 2. Role 편집 방식

**UI 위치**: CutCard 내 multiShot 영역 (현재 읽기 전용 뱃지) → inline 편집 가능 카드 그리드로 확장

**편집 인터랙션**:
- 각 shot card에 role 드롭다운 (6종)
- role 선택 시 자동 뱃지 색상 변경 (establish=blue, develop=green, peak=red, resolve=purple, insert=amber, transition=gray)
- prompt textarea: 인라인 편집, 실시간 글자 수 카운터 (n/512)
- duration: 숫자 input (±1초 스텝 버튼) — 변경 시 인접 shot과 합산 재계산
- role 자동 추천: 새 shot 추가 시 position 기반 기본값

**role은 메타데이터이지 hard constraint가 아님**: role이 "peak"이어도 prompt를 자유 편집 가능.
generate-cuts가 새로 생성할 때만 role 기반 가이드라인 적용.

### 3. Validation 책임 분리

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Editor Layer   │     │   Export Layer    │     │   API Layer     │
│  (실시간 UX)    │────▶│  (전송 전 게이트) │────▶│  (서버 최종 방어)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Editor Layer** (CutCard / ShotEditor 내부, 실시간):
- shot 개수: 0 < n ≤ getMaxShots(model, duration)
- 개별 prompt 길이: ≤512자 (경고 450자, 에러 512자)
- 개별 duration: ≥ minShotDuration (모델별)
- duration 합: == cut.durationSec (±0.5초 허용 → 경고, 초과 시 에러)
- 빈 prompt: 에러 (prompt.trim().length === 0)
- index 순차: 자동 보정 (UI가 항상 1-based 순차 보장)

**Export Layer** (Kling Payload Preview / Export 직전):
- normalizeMultiShots() 호출 — 서버와 동일한 clamp 정책 적용
- final-payload-validator.ts 확장 — multiShot 전용 rule 추가
- role 분포 경고: 모든 shot이 같은 role이면 "단조로움 경고"
- 전체 prompt 문자열 합산 길이 제한 (Kling API 한도)

**API Layer** (generate-video.ts, _kling-api.ts):
- normalizeMultiShots() — 서버 사이드 최종 clamp (이미 구현됨)
- model capability 기반 hard limit 강제 (이미 구현됨)
- 잘못된 모델에 multiShot 전달 시 무시 (supportsMultiShot=false → 빈 배열)

### 4. 결과 패널 UI 개편안

**현재**: CutCard에 multiShot은 읽기 전용 뱃지 (「샷1 3s」「샷2 5s」)

**개편**:

```
┌─────────────────────────────────────────────────────┐
│ 장면 3  ·  8초  ·  Fast  ·  Extend                  │
│ 등장: 박지성                                          │
├─────────────────────────────────────────────────────┤
│ 그가 천천히 고개를 들어 관중석을 바라본다...           │
│                                                      │
│ ── 멀티샷 (3/4) ──────────────── [+ 샷 추가]        │
│ ┌──────────────────────────────────────────────┐    │
│ │ 1  [establish ▾]  3초  [-][+]                │    │
│ │ Wide shot of the stadium from behind...      │    │
│ │                                    312/512   │    │
│ └──────────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────────┐    │
│ │ 2  [develop ▾]    3초  [-][+]                │    │
│ │ Medium close-up as he turns toward...        │    │
│ │                                    245/512   │    │
│ └──────────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────────┐    │
│ │ 3  [peak ▾]       2초  [-][+]                │    │
│ │ Close-up of his face, tears forming...       │    │
│ │                                    189/512   │    │
│ └──────────────────────────────────────────────┘    │
│                                                      │
│ ── Validation ──────────────────────────────────     │
│ ✅ shot 수: 3/4 (O3 8초 기준)                        │
│ ✅ duration 합: 8초 = 8초                             │
│ ✅ 모든 prompt 512자 이내                             │
│ ⚠️ 모든 shot이 같은 role (develop) — 다양화 권장     │
├─────────────────────────────────────────────────────┤
│ 📷 카메라: ...  ·  🎨 무드: ...                       │
│ 프롬프트 보기 / 수정하기 ▾                            │
└─────────────────────────────────────────────────────┘
```

**주요 변경**:
1. multiShot 영역이 읽기 전용 뱃지 → 인라인 편집 카드 그리드
2. 각 shot에 role 드롭다운 + duration ± 버튼 + prompt textarea
3. 실시간 validation 결과가 카드 하단에 표시
4. [+ 샷 추가] 버튼 (getMaxShots 한도 내에서)
5. shot 삭제 버튼 (hover 시 표시)
6. 모든 변경은 Cut 객체에 즉시 반영 → ResultPanel.handleCutUpdate → 상위 전파

### 5. 구현 순서

1. **ShotRole 타입 + ShotCardModel 확장** (types/index.ts)
2. **ShotRoleEditor 컴포넌트** (신규) — role 드롭다운 + 색상 매핑
3. **MultiShotEditor 컴포넌트** (신규) — shot card 그리드 + inline editing
4. **MultiShotValidation 유틸** (신규) — editor layer 실시간 검증
5. **CutCard 통합** — 기존 읽기 전용 multiShot 뱃지 → MultiShotEditor 교체
6. **final-payload-validator.ts 확장** — export layer multiShot rule
7. **generate-cuts.ts 확장** — role 필드 생성 + 가이드라인 주입
8. **테스트** — validation rule 단위 테스트 + 통합 테스트
