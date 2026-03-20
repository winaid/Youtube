# Multi-Shot Architecture

## Why Multi-Shot-First

This product treats multi-shot as the default operating mode for eligible clips — not an optional enhancement. The reasoning:

1. **Retention.** Single-shot video over 6-9 seconds tends to lose viewer attention. Structured shot progression (establish → develop → peak → resolve) creates rhythm.
2. **Production quality.** Real cinematography uses shot changes. A 12-second single-take feels like raw footage, not a produced sequence.
3. **VEO capability alignment.** VEO supports 4-shot multishot (2+2+2+2) per generation with 2-second minimum shot duration. The product is built to use this capability by default.

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

| Duration | Recommended Shots |
|----------|-------------------|
| ≤3s | 1 (single-shot only) |
| 4-5s | 2 |
| 6-8s | 2-3 |
| 9-12s | 3-4 |
| 13-15s | 4-6 |

These are starting recommendations. `getMaxShots()` applies further limits based on model capability and physical constraints (`floor(duration / minShotDuration)`).

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

## Intentional One-Take

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

### UI visibility

- CutCard shows a gray "의도적 원테이크" badge when active.
- Toggle button: "멀티샷으로 전환" (convert to multi-shot).
- Recovery UI shows "원테이크" badge on job cards.
- Export JSON includes `intentionalOneTake: true` per cut.

### How to set it

In CutCard, clicking "의도적 원테이크로 전환" calls:
```ts
onUpdate({ ...cut, multiShot: [], intentionalOneTake: true })
```

This clears the multi-shot array and sets the flag. The reverse operation ("멀티샷으로 전환") rebuilds shots via `buildDefaultMultiShot()` and clears the flag.

## Unsupported Model Fallback

When a model or duration doesn't support multi-shot:

| Condition | Result |
|-----------|--------|
| Non-multishot models | maxShots=0. MultiShotEditor not rendered. No auto-init. |
| Duration ≤3s | maxShots=0. Single-shot only. No force. |
| Unknown model | Defaults to VEO text-to-video capability (safe fallback). |

**UI behavior**: CutCard's auto-init useEffect checks `getMaxShots()`. If 0, no shots are generated and the editor shows the cut without a multi-shot section. No confusing "opt into multi-shot" prompt appears.

**Export/payload honesty**: If multi-shot is not supported, `multiShot` is `null` in the export JSON. The server strips `multiShot` if `serverMaxShots <= 0`.

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
| `functions/api/generate-video.ts` | Server enforcement, auto-repair, VEO submission |
