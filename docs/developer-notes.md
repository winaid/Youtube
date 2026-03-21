# Developer Maintenance Notes

## Key Files and What They Own

### Core Logic (src/lib/)

| File | Responsibility |
|------|---------------|
| `multi-shot-planner.ts` | Shot count recommendation, role assignment, duration distribution, force rules, repair logic |
| `veo-capability.ts` | Model registry (VEO), maxShots, minShotDuration, eligibility checks, model resolution |
| `multishot-validation.ts` | Editor-layer validation, Studio/Batch mode checks, shot add/remove/resize with duration redistribution |
| `final-payload-validator.ts` | 17-rule pre-submission validation. Rule 17 is force-multishot enforcement. |
| `video-generation-core.ts` | `submitVideoGeneration()`, `pollVideoTask()`, `prepareMultiShotPayload()`, error classification |
| `batch-runtime-budget.ts` | 300s budget check, over-budget suggestions, batch split algorithm |
| `video-job-store.ts` | localStorage job persistence, recovery, cleanup. `JobRequestSummary` type lives here. |
| `duration-reconciliation.ts` | Duration 정책 (8초 고정), auto-duration fallback, summary rendering |
| `sequence-assembler.ts` | `assembleFromJSON()` — builds `StructuredSequenceDocument` from cuts + config |

### Server (functions/api/)

| File | Responsibility |
|------|---------------|
| `generate-video.ts` | Final enforcement: model selection, prompt serialization, multi-shot policy (Studio block / Batch repair), VEO API call |
| `_veo-api.ts` | VEO client, types (`VeoGenerateRequest`), error classes |
| `_veo-capability.ts` | Server-side model registry (must stay in sync with client `veo-capability.ts`) |

### UI Components (src/components/prompt-generator/)

| File | Responsibility |
|------|---------------|
| `ResultPanel.tsx` | Master layout, export JSON construction, mode toggle, budget display |
| `VideoGenerationPanel.tsx` | Job cards, recovery UI, payload preview (3-tier), progress display |
| `CutCard.tsx` | Per-cut editor, multi-shot auto-initialization, one-take toggle, camera presets |
| `MultiShotEditor.tsx` | Per-shot editing: role dropdown, duration ±, prompt textarea, validation display |

### Hooks (src/hooks/)

| File | Responsibility |
|------|---------------|
| `useVideoGeneration.ts` | Job creation, submission orchestration, config state, auto-mode, recovery resume, quality pipeline |

## Where Things Happen

### Where validation happens

```
Editor real-time    → multishot-validation.ts (validateMultiShots)
Pre-submit client   → final-payload-validator.ts (validateFinalProviderPayload, 17 rules)
Pre-submit repair   → video-generation-core.ts (prepareMultiShotPayload → repairMissingMultiShot)
Server enforcement  → generate-video.ts (shouldForce + Studio block / Batch repair)
Server normalization→ generate-video.ts (normalizeMultiShots — clamp to model limits)
```

### Where the final payload shape is determined

1. `useVideoGeneration.ts` `generateCut()` builds `submitParams` with multiShot array.
2. `video-generation-core.ts` `submitVideoGeneration()` builds the HTTP body with `structuredSequence`, `multiShot`, and all metadata.
3. `generate-video.ts` on the server serializes `structuredSequence` to a prompt string, auto-repairs multiShot if needed, normalizes shots, and submits to VEO.

The final VEO payload uses timestamp-based prompts:
```
{
  model: resolved model ID,
  prompt: timestamp-formatted string (e.g., "0s: scene description, 2s: next scene, ..."),
  negativePrompt: string,
  duration: 8 (VEO fixed),
  aspectRatio: "16:9" | ...,
  ... (image, etc.)
}
```

### Where server enforcement happens

`functions/api/generate-video.ts` lines ~618-673:

1. Compute `shouldForce` from duration + scene type + model capability.
2. Check `intentionalOneTake` — if true, skip enforcement.
3. If `shouldForce && !hasMultiShotPayload`:
   - Studio → return 400 error.
   - Batch → generate default shots, assign to `req.multiShot`.
4. After enforcement, `normalizeMultiShots()` clamps shots to model limits.

### Where recovery metadata is stored

`video-job-store.ts` `createJob()` stores:
```ts
requestSummary: {
  promptPreview,        // first 80 chars
  durationSeconds,
  aspectRatio,
  videoMode,
  multiShotCount,       // cut.multiShot.length
  multiShotRoles,       // cut.multiShot.map(s => s.role)
  generationMode,       // "studio" | "batch"
  intentionalOneTake,   // boolean
}
```

This is populated in `useVideoGeneration.ts` during job creation.

## What Not to Change Carelessly

### Force scene type sets must stay in sync

Three locations define the same set:
- `src/lib/multi-shot-planner.ts` → `FORCE_MULTI_SHOT_SCENE_TYPES`
- `functions/api/generate-video.ts` → `FORCE_SCENE_TYPES`
- `tests/phase2-multishot-default.test.ts` → test mirror

If you add a scene type to one, add it to all three.

### Model capability registries must match

- `src/lib/veo-capability.ts` (client)
- `functions/api/_veo-capability.ts` (server)

Both define model maxShots, minShotDuration, etc. A mismatch means the client plans more shots than the server allows (or vice versa), causing silent clamping or unexpected blocks.

### CutCard auto-init useEffect

```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { ... }, [modelId, cut.durationSec, cut.shotCategory]);
```

This intentionally excludes `onUpdate`, `cut.multiShot`, and `cut.intentionalOneTake` from the dependency array. Adding them causes an infinite update loop: the effect calls `onUpdate`, which changes the cut, which re-triggers the effect. Do not "fix" the lint warning.

### VEO timestamp prompts have no role field

The provider API uses timestamp-based prompts (e.g., `"0s: description, 2s: next"`). Roles exist only in the client's `MultiShotPrompt` type. Do not add `role` to VEO payloads unless the VEO API actually supports it.

### Client repair defers to server

`prepareMultiShotPayload()` passes `modelId: undefined` because the client doesn't resolve the final model. This means the client repair function (`repairMissingMultiShot`) only preserves existing shots — it cannot force-generate new ones without knowing model limits. The server handles authoritative generation. Do not "fix" this by guessing a model ID on the client.

## Common Pitfalls

### Don't reintroduce single-shot-first UX

The product is multi-shot-first. Eligible clips auto-initialize with multi-shot structure on mount. If you add a new entry point for clip creation, ensure it calls `buildDefaultMultiShot()` for eligible clips. Don't show an empty editor with a "try multi-shot?" button.

### Don't hide real payload structure

The export JSON and preview must show `multiShot[]` with roles, durations, and prompts. The flattened rendered prompt string is labeled as debug-only ("렌더링된 프롬프트 (디버그용)"). Don't promote it to primary display.

### Don't conflate Studio and Batch behavior

Studio blocks invalid payloads. Batch auto-repairs. These are different products for different users. Don't add review-heavy friction to Batch, and don't add auto-repair to Studio.

### Don't break intentional one-take

One-take is an explicit user decision. It must flow through all layers:
- Editor: `cut.intentionalOneTake = true`
- Client validator: skip Rule 17
- Client repair: skip `repairMissingMultiShot()`
- Server: skip `shouldForce` enforcement
- Recovery: stored in `requestSummary.intentionalOneTake`
- Export: `intentionalOneTake: true` per cut

If you add a new validation or enforcement layer, check for `intentionalOneTake`.

### Don't assume all models support multi-shot

Not all models support multi-shot. Always check `getMaxShots()` or `isMultiShotEligible()` before assuming multi-shot is available.

### Don't add duration without updating maxShots

If VEO adds support for variable durations, `getMaxShots()` has duration-based limits that need updating:
```
≤5s → max 2
≤7s → max 3
≤10s → max 4
>10s → model limit
```

## Test Coverage

54 test files, 1556 tests. Key test suites:

| Suite | What It Verifies |
|-------|-----------------|
| `phase2-multishot-default.test.ts` | Force rules, shouldForceMultiShot, scene type thresholds |
| `phase3-qa-edge-cases.test.ts` | 6 edge cases (12s cinematic, 15s env, one-take, batch overflow, unsupported model, recovery) |
| `multishot-validation.test.ts` | Editor validation, duration redistribution, add/remove/resize |
| `multishot-clamp-policy.test.ts` | Model limit clamping, normalizeMultiShots |
| `multishot-default-submission.test.ts` | Submission-time repair behavior |
| `batch-runtime-budget.test.ts` | 300s budget, suggestions, split algorithm |
| `mode-aware-validation.test.ts` | Studio vs Batch validation differences |
| `video-generation-core.test.ts` | Submission flow, polling, error classification |

Run all tests: `npx vitest run tests/`

## File Structure Reference

```
src/
  lib/
    multi-shot-planner.ts      ← shot planning core
    veo-capability.ts          ← model registry (client)
    multishot-validation.ts    ← editor validation
    final-payload-validator.ts ← 17-rule validator
    video-generation-core.ts   ← submit + poll
    batch-runtime-budget.ts    ← 300s budget
    video-job-store.ts         ← localStorage jobs
    duration-reconciliation.ts ← duration slider/auto
    sequence-assembler.ts      ← JSON assembly
  components/prompt-generator/
    ResultPanel.tsx             ← master layout + export
    VideoGenerationPanel.tsx    ← job cards + recovery
    CutCard.tsx                 ← per-cut editor
    MultiShotEditor.tsx         ← per-shot editor
  hooks/
    useVideoGeneration.ts      ← orchestration hook
functions/api/
  generate-video.ts            ← server enforcement
  _veo-api.ts                  ← VEO client + types
  _veo-capability.ts           ← model registry (server)
docs/
  HANDOFF.md                   ← product overview
  multishot-architecture.md    ← multi-shot deep dive
  runtime-budget-and-operations.md ← budget + ops
  developer-notes.md           ← this file
tests/
  (54 test files)
```
