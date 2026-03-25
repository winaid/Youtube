# Multi-Shot Architecture

## Why Multi-Shot-First

This product treats multi-shot as the default operating mode for eligible clips — not an optional enhancement. The reasoning:

1. **Retention.** Single-shot 8-second video tends to lose viewer attention. Structured shot progression (establish → develop → peak → resolve) creates rhythm.
2. **Production quality.** Real cinematography uses shot changes. A single-take feels like raw footage, not a produced sequence.
3. **VEO capability alignment.** VEO generates 8-second clips with 4-shot multishot (2+2+2+2) and 2-second minimum shot duration. The product is built to use this capability by default.

## Planning Flow

```
Input: durationSec, sceneType, modelId, basePrompt
                      ↓
    planRecommendedShotCount(modelId, durationSec, sceneType)
        → heuristic lookup by duration range
        → scene-type bias applied
        → clamped to getMaxShots(modelId, durationSec)
                      ↓
    planShotRoles(shotCount)
        → retention role pattern from RETENTION_ROLE_PATTERNS
                      ↓
    distributeDurations(roles, totalDurationSec, minShotDuration)
        → weighted allocation (establish 1.2x, insert 0.8x, etc.)
        → remainder absorbed by highest-weight role
                      ↓
    Output: MultiShotPrompt[] with {index, prompt, duration, role}
```

### Shot Count Heuristics

현재 VEO 정책은 **8초 고정 멀티샷**. 아래 테이블은 내부 플래닝 기준이며, 실제 생성은 항상 8초.

| Duration | Recommended Shots | 비고 |
|----------|-------------------|------|
| ≤3s | 1 (단일샷) | 멀티샷 불필요 |
| 4-8s | 3-4 | 기본 멀티샷 범위 (현재 정책: 8초 고정) |
| 9-15s | 3-4 | 내부 플래닝 기준 |

`getMaxShots()` 가 모델 capability와 물리 제약(`floor(duration / minShotDuration)`)으로 추가 제한.

### Role Progression Patterns

| Shots | Pattern |
|-------|---------|
| 1 | establish |
| 2 | establish → resolve |
| 3 | establish → develop → resolve |
| 4 | establish → develop → peak → resolve |
| 5 | establish → transition → develop → peak → resolve |
| 6 | establish → transition → develop → insert → peak → resolve |
| 7+ | Base 6 + alternating develop/insert inserts in middle |

### Duration Weight by Role

| Role | Weight | Rationale |
|------|--------|-----------|
| establish | 1.2x | Hook — needs time to orient viewer |
| develop | 1.0x | Standard progression |
| peak | 1.1x | Reveal — slightly longer for impact |
| resolve | 1.1x | Payoff — slightly longer for closure |
| insert | 0.8x | Intensify — shorter, rhythmic |
| transition | 0.8x | Orient — shorter, bridging |

## Force Multi-Shot Rules

Two thresholds determine when multi-shot is mandatory:

**Absolute threshold:** ≥9 seconds, any scene type → multi-shot forced.

**Scene-type threshold:** ≥6 seconds + scene type in `{cinematic_sequence, environment, character-driven, battle, montage}` → multi-shot forced.

These thresholds are enforced at three layers:
1. **Editor** (`CutCard.tsx`): Auto-initializes multi-shot on eligible clips via useEffect.
2. **Client validation** (`final-payload-validator.ts`, Rule 17): Flags missing multi-shot as error (Studio) or warning (Batch).
3. **Server** (`generate-video.ts`): Blocks (Studio) or auto-repairs (Batch) missing multi-shot.

The sets must stay in sync across these three locations:
- `src/lib/multi-shot-planner.ts` → `FORCE_MULTI_SHOT_SCENE_TYPES`
- `functions/api/generate-video.ts` → `FORCE_SCENE_TYPES`
- `tests/phase2-multishot-default.test.ts` → test constant

## Editor → Submit Consistency

**Invariant:** The editor and submitter must agree on the shot structure. There is no path where the editor shows single-shot but submission silently transforms to multi-shot.

The flow:
1. CutCard auto-initializes multi-shot if eligible (useEffect fires on mount/modelId change).
2. User edits shots in MultiShotEditor (role, duration, prompt per shot).
3. On submit, `useVideoGeneration.ts` clamps to maxShots and re-indexes.
4. Client-side `prepareMultiShotPayload()` preserves existing shots (no silent generation — it doesn't know the model).
5. Server receives the shots as-is, or auto-repairs only in Batch mode if none were provided.

If the user removes all shots without setting `intentionalOneTake=true`, the validator flags this. Studio blocks it; Batch warns but auto-repairs server-side.

## Studio vs Batch Differences

### Studio Mode

- **Validation**: Blocking. Missing forced multi-shot → 400 error. Extra checks for role progression (peak/resolve present for 3+ shots) and prompt variety (no duplicate prompts).
- **User experience**: Deliberate. The user must fix issues before submission.
- **Server behavior**: Rejects invalid payloads. No auto-repair.
- **Use case**: Critical content, manual review, single-clip refinement.

### Batch Mode

- **Validation**: Permissive. Missing multi-shot → warning only. No role/variety checks.
- **User experience**: Low-friction. Submit and move on.
- **Server behavior**: Auto-repairs missing multi-shot by generating default shots with even duration distribution and the base prompt.
- **Use case**: Bulk generation, rapid iteration, automated pipelines.

### What the server auto-repairs (Batch only)

When forced multi-shot is required but missing:

```
autoShotCount:
  ≤5s  → 2 shots
  ≤8s  → 3 shots
  ≤12s → 4 shots
  >12s → min(5, serverMaxShots)

Duration: evenly distributed, last shot absorbs remainder.
Prompt: base prompt copied to all shots.
Roles: NOT assigned (VEO timestamp format has no role field).
```

After auto-repair, `normalizeMultiShots()` clamps to model limits and enforces `minShotDuration`.

## Intentional One-Take (현재 제품 정책: 비활성)

> **현재 정책:** 모든 생성은 8초 멀티샷 고정. UI에서 "단일 샷으로 전환" 버튼은 제거되었으며, 기존 원테이크 상태의 컷은 멀티샷 전환을 권장 표시합니다. 내부 코드 경로는 하위 호환을 위해 유지하되, 사용자가 새로 one-take를 설정하는 UI 진입점은 없습니다.

One-take is an explicit exception, not a default. The user must actively set `intentionalOneTake=true`.

### Where it's checked

| Layer | Behavior |
|-------|----------|
| `isOneTakeAllowed()` | Returns true if duration ≤3s OR intentionalOneTake=true |
| `repairMissingMultiShot()` | Skips repair if one-take allowed |
| `validateStudioMode()` | Skips force-multishot check if intentionalOneTake |
| `final-payload-validator.ts` Rule 17 | Skips if intentionalOneTake |
| Server `generate-video.ts` | `isIntentionalOneTake` check in `shouldForce` calculation |
| CutCard auto-init useEffect | Returns early if `cut.intentionalOneTake` |

### UI visibility (현재 정책 반영)

- "단일 샷으로 전환" 버튼: **제거됨** (현재 정책상 8초 멀티샷 고정).
- 기존 원테이크 컷: "단일 샷 (권장하지 않음)" 배지 + "멀티샷으로 전환 (권장)" 버튼 표시.
- Recovery UI는 "원테이크" 배지를 하위 호환용으로 유지.
- Export JSON에는 `intentionalOneTake: true`가 하위 호환용으로 남아 있을 수 있음.

### How to set it (deprecated)

현재 UI에서 새로 one-take를 설정하는 진입점은 없습니다.
기존 데이터 호환을 위해 코드 경로는 유지하되, 멀티샷 전환을 적극 권장합니다.

## Unsupported Model Fallback

When a model or duration doesn't support multi-shot:

| Condition | Result |
|-----------|--------|
| Non-multishot models | maxShots=0. MultiShotEditor not rendered. No auto-init. |
| Duration ≤3s | maxShots=0. Single-shot only. No force. |
| Unknown model | Defaults to VEO text-to-video capability (safe fallback). |

**UI behavior**: CutCard's auto-init useEffect checks `getMaxShots()`. If 0, no shots are generated and the editor shows the cut without a multi-shot section. No confusing "opt into multi-shot" prompt appears.

**Export/payload honesty**: If multi-shot is not supported, `multiShot` is `null` in the export JSON. The server strips `multiShot` if `serverMaxShots <= 0`.

## separate_clips 모드

### 개요

기본 모드(8초 멀티샷)는 4개 서브샷을 타임스탬프 프롬프트로 묶어 **1회 VEO 요청**으로 생성한다.
`separate_clips` 모드는 각 서브샷을 **독립 VEO 요청**으로 보내고, 최종 결과를 **hard cut**으로 조립한다.

### 언제 사용하는가

- 서브샷마다 완전히 다른 시각적 톤/스타일이 필요할 때
- 개별 샷의 품질 제어가 중요할 때 (실패한 샷만 재생성 가능)
- 프로덕션 수준 컷바이컷 제어가 필요할 때

### 요청 흐름

```
Client: { separateClips: true, multiShot: [shot_1, shot_2, shot_3, shot_4] }
           ↓
Server: separate_clips 감지
           ↓
  shot_1 → veoGenerate(prompt=shot_1.prompt, duration=shot_1.duration)
  shot_2 → veoGenerate(prompt=shot_2.prompt, duration=shot_2.duration)
  shot_3 → veoGenerate(prompt=shot_3.prompt, duration=shot_3.duration)
  shot_4 → veoGenerate(prompt=shot_4.prompt, duration=shot_4.duration)
           ↓
Response: { separateClips: true, clipOperations: [...], assembly: { method: "hard_cut" } }
           ↓
Client post step: hard cut 조립 (cross-dissolve/transition 없음)
```

### 타임스탬프 프롬프트와의 차이

| 항목 | 기본 (timestamp) | separate_clips |
|------|-------------------|----------------|
| VEO 요청 수 | 1회 | shot 수만큼 |
| 프롬프트 형식 | `[00:00-00:02] ...` | 플레인 텍스트 (타임스탬프 없음) |
| 조립 | VEO 내부 | 클라이언트 hard cut |
| 개별 샷 재생성 | 불가 | 가능 |
| 연속성 | VEO가 보장 | 프롬프트 일관성으로 유지 |

### 응답 형식

```typescript
{
  separateClips: true,
  clipOperations: [
    { shotIndex: 1, role: "establish", durationSec: 2, operationName: "op_xxx", prompt: "..." },
    { shotIndex: 2, role: "develop", durationSec: 2, operationName: "op_yyy", prompt: "..." },
    ...
  ],
  assembly: { method: "hard_cut", totalShots: 4, successfulShots: 4 },
  errors?: [{ shotIndex: 3, error: "..." }]
}
```

### 언어 정책

- **provider/VEO에 보내는 필드**: 영어 전용. 한국어 텍스트는 `stripTextForVeo()`에서 제거됨.
- **UI에 보여주는 필드**: 한국어 전용.
  - Ko 필드가 비어 있을 때 영어를 복사하지 않고 반드시 번역/생성.
  - `promptKo` 생성 시 영어 clause 혼입 금지, 100% 한국어.
  - `refine/verify`로 영어 prompt가 바뀌면 `sentPromptEn`/`sentPromptKo`를 전송 직전 기준으로 갱신.
  - UI에는 "실제 전송된 최종 영어 prompt의 한국어 번역본"(`sentPromptKo`)을 표시.

## Key Files

| File | Owns |
|------|------|
| `src/lib/multi-shot-planner.ts` | Planning: shot count, roles, durations, force rules |
| `src/lib/veo-capability.ts` | Model registry, maxShots, minShotDuration, eligibility |
| `src/lib/multishot-validation.ts` | Editor validation, Studio/Batch mode checks, duration redistribution |
| `src/lib/final-payload-validator.ts` | 17-rule pre-submission validation (Rule 17 = forced multi-shot) |
| `src/lib/video-generation-core.ts` | Client-side repair, submission, polling |
| `src/components/prompt-generator/CutCard.tsx` | Per-cut editor, auto-init, one-take toggle |
| `src/components/prompt-generator/MultiShotEditor.tsx` | Shot-level editing UI |
| `functions/api/generate-video.ts` | Server enforcement, auto-repair, VEO submission, separate_clips 모드 |
| `functions/api/_veo-prompt-renderer.ts` | Timestamp formatting, renderSeparateClipShots() |
