# Runtime Budget & Operations

## Batch Runtime Budget

### Constants

| Constant | Value | Location |
|----------|-------|----------|
| `BATCH_BUDGET_SECONDS` | 300 (5 minutes) | `src/lib/batch-runtime-budget.ts` |
| `BUDGET_WARNING_RATIO` | 0.8 (80%) | Same file |
| `MAX_CLIPS_PER_BATCH` | 50 | Same file |

### How It Works

`checkBatchBudget(clips)` sums all clip durations and returns:

```ts
{
  totalRuntimeSec: number,      // sum of all clip durations
  withinBudget: boolean,        // totalRuntime ≤ 300
  severity: "ok" | "warning" | "over_budget",
  overBudgetSec: number,        // how much over (0 if within)
  usageRatio: number,           // totalRuntime / 300
  suggestions: string[],        // remediation options
  message: string,              // human-readable summary
}
```

### Severity Levels

| Severity | Condition | User Impact |
|----------|-----------|-------------|
| `ok` | ≤240s (80%) | Green badge. No action needed. |
| `warning` | 241-300s | Amber badge. "예산 근접" message. Suggestion to reduce. |
| `over_budget` | >300s | Red badge. "+Xs 초과" shown. Split/reduction suggestions. |

### Over-Budget Suggestions

When over budget, the system generates concrete suggestions:

1. **Clip count reduction**: `targetClips = floor(300 / avgDuration)` → "클립 수를 N개로 줄이세요"
2. **Batch split**: `ceil(totalRuntime / 300)` batches → "N개 배치로 분할" with per-batch breakdown
3. **Per-clip duration target**: `floor(300 / clipCount)` → "클립당 Ns 이하로"
4. **Clip count warning**: If >50 clips, additional performance warning.

### Batch Split Algorithm

`suggestBatchSplit(clips)` uses a greedy algorithm:

```
for each clip (sorted by id):
    if adding clip to current batch would exceed 300s:
        start new batch
    add clip to current batch
```

Returns batch count, per-batch clip lists, and per-batch totals.

### Where Budget Is Shown

| Location | What's Shown |
|----------|-------------|
| ResultPanel header badges | `Xs / 300s 예산` with color coding |
| Export JSON | `runtimeBudget: { totalSec, budgetSec, withinBudget, usage }` |
| Batch submit flow | Over-budget warning blocks or warns |

### Example: 30 clips × 12s

- Total: 360s
- Over budget by: 60s
- Severity: `over_budget`
- Suggestions: reduce to 25 clips, or split into 2 batches (25×12s=300s + 5×12s=60s)

## Polling & Long-Running Jobs

### Adaptive Polling Intervals

| Elapsed Time | Interval | Rationale |
|-------------|----------|-----------|
| 0-2 min | 5s | Initial responsiveness |
| 2-5 min | 10s | Moderate patience |
| 5-10 min | 20s | Reducing load |
| 10+ min | 30s | Long-running, minimal polling |

### Timeout Behavior

- Default: max 60 attempts (~5 min)
- Long-running mode: max 180 attempts (~15 min)
- On timeout: job marked `timeout_recoverable` (not `failed`)
- User can "다시 확인" (Check Again) to resume polling

### Error Handling During Polling

- Max 3 consecutive errors before failing
- Error backoff: [5s, 7.5s, 10s, 15s, 20s]
- HTTP 4xx: fail immediately (not retryable)
- HTTP 5xx + 3 consecutive: mark `timeout_recoverable`
- Network errors: retryable up to 3 consecutive

## Job Recovery

### Job Lifecycle

```
queued → submitted → processing → completed
                   ↘ failed
                   ↘ timeout_recoverable
```

### What's Stored (localStorage)

Each job record (`VideoJobRecord`) stores:

| Field | Purpose |
|-------|---------|
| `jobId` | Client-generated UUID |
| `taskId` | Provider task ID (after submission) |
| `status` | Current lifecycle state |
| `requestSummary.multiShotCount` | Number of shots planned |
| `requestSummary.multiShotRoles` | Role sequence (e.g., ["establish", "develop", "resolve"]) |
| `requestSummary.generationMode` | "studio" or "batch" |
| `requestSummary.intentionalOneTake` | Whether one-take was explicit |
| `requestSummary.promptPreview` | First 80 chars of prompt |
| `requestSummary.durationSeconds` | Requested duration |

### Recovery UI

On page load, `getRecoverableJobs()` fetches all jobs in `submitted`, `processing`, or `timeout_recoverable` states.

The recovery banner shows per-job:
- Scene number + status badge
- Elapsed time
- Prompt preview
- **Generation mode** badge (Studio purple / Batch teal)
- **Shot count** badge (e.g., "3샷")
- **Role progression** text (e.g., "establish → develop → resolve")
- **One-take** badge if applicable
- Resume button

### Auto-Cleanup

| Condition | Action |
|-----------|--------|
| Queued, no taskId, >1 hour | Delete |
| Completed/failed, >7 days | Delete |
| >100 total jobs | Remove oldest completed/failed |
| localStorage quota exceeded | Keep 20 completed + all pending |

### Understanding Server-Repaired Jobs

When a Batch mode job has `multiShotCount=0` in its stored metadata, the server may have auto-repaired it. The stored metadata reflects what the **client sent**, not what the server ultimately submitted to VEO. This is a known limitation — there's no explicit "was auto-repaired" flag yet.

## Throughput Philosophy

Batch Mode is designed around throughput:

1. **Low friction submission.** No blocking validation for missing multi-shot. Server repairs transparently.
2. **Budget awareness.** Users see total runtime early enough to adjust before submitting.
3. **Auto-mode generation.** `startAutoGeneration()` processes clips sequentially — waits for each to finish uploading before starting the next.
4. **Auto-retry.** On failure, auto-retry with strengthened negative prompts (up to `maxRetryCount`).

Studio Mode is designed around craft:

1. **Blocking validation.** Missing multi-shot is a 400 error. Fix it first.
2. **Extra checks.** Role progression and prompt variety validated.
3. **Manual review.** User initiates each generation deliberately.

## What Operators Should Watch For

1. **Budget creep.** Large batches (30+ clips × 12s) easily exceed 300s. The warning is shown but not enforced as a hard block on the client side.
2. **Recovery pile-up.** Long-running jobs in `timeout_recoverable` accumulate in localStorage. Auto-cleanup handles >100 jobs, but clusters of stuck jobs may confuse users.
3. **Server repair divergence.** If a user recovers a Batch job that was server-repaired, the recovery metadata shows the original (possibly zero-shot) intent, not the repaired structure.
4. **Model access 403s.** If a VEO model becomes unavailable, the system falls back to a lower-capability model (maxShots=3, minShotDuration=3s). This changes the multi-shot limits but doesn't break the flow.
