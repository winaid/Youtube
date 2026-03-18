# Internal Owner-Only Creator Studio V0.9 — Implementation Plan

## Current State Assessment

### Already Working
- Story input + duration + director selection (InputPanel)
- Cut generation via Gemini (generate-cuts API)
- Cut editing (CutCard + MultiShotEditor)
- Shot editing + shot visibility (ShotInspector, ShotComparisonPanel)
- Variant generation (ShotVariantPanel)
- Video generation + polling (useVideoGeneration hook)
- Prompt history (localStorage, 30 entries)
- Video history (localStorage, 200 entries)
- Job recovery on page refresh

### Missing for V0.9
1. **Named Draft Save/Load** — no project-level persistence
2. **Recent Drafts List** — no project browser
3. **Unified Debug Panel** — quality metadata scattered across inspectors
4. **Sample Projects** — no quick-start templates
5. **Draft Export/Import** — no file-based backup

---

## Implementation Tasks

### Phase 1: Draft Schema + IndexedDB Persistence
File: `src/lib/draft-store.ts`

- DraftProject schema: id, title, createdAt, updatedAt, storyInput, directorId,
  durationConfig, cuts[], videoClips[], generationMeta
- IndexedDB via simple wrapper (no heavy lib)
- Auto-save on every generation + manual save button
- List/load/delete/export/import operations
- Migration-ready: schema version field for future auth migration

### Phase 2: Project Manager UI
File: `src/components/prompt-generator/ProjectManager.tsx`

- Sidebar or modal: recent drafts list (title, date, cut count, thumbnail)
- "New Project" button (clears workspace)
- "Load Draft" (restores full state)
- "Save Draft" (explicit save with title)
- "Export JSON" / "Import JSON" for file backup
- Sample project loader (3-4 built-in templates)

### Phase 3: Debug Quality Panel
File: `src/components/prompt-generator/QualityDebugPanel.tsx`

- Collapsible panel showing:
  - totalDuration, targetCuts, reconciled secPerCut
  - narrativeFunction, temporalBeats
  - shot count per cut
  - shortform rhythm policy (band, minCuts, is13to15Special)
  - fallback/degraded flags
  - director pace down-weight
  - sequencePlan validation summary
  - density policy applied
- Reads from existing PromptOutput + generationMeta

### Phase 4: Sample Projects
File: `src/data/sample-projects.ts`

- 3-4 pre-built story inputs covering:
  - 15s shortform (rhythm policy test)
  - 60s standard (multi-segment test)
  - 120s long-form (batch budget test)
  - Director style variation (same story, different director)

### Phase 5: Workspace Flow Polish
- Auto-save indicator ("Saved" / "Unsaved changes")
- Keyboard shortcut: Cmd+S to save draft
- Clear "current project" title in header
- Confirm dialog on "New Project" if unsaved

---

## Excluded (per scope definition)
- Login / signup / auth / session
- Billing / credits / usage limits
- Team features / multi-user
- Landing page / marketing
- Permission system
