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
3. 이 규칙은 추천/자동 조정/하드캡/예외 처리보다 우선
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
