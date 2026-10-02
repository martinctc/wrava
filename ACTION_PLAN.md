ACTION PLAN — Remember last workspace folder

Goal: reopen the last used writing folder on startup, without regressing startup
speed, demo behaviour, or existing activity history.

1. PERSISTENCE LAYER
- Add WORKSPACE_KEY = "wrava.workspace.v1" in a new src/workspaceMemory.ts
  (keeps workspace concerns out of settings.ts, which validates user preferences).
- Store only the absolute root path string, never full workspace state.
- Helpers: saveWorkspacePath(path), loadWorkspacePath(), forgetWorkspacePath().
- All helpers must be storage-guarded: wrap localStorage access in try/catch so a
  blocked or full storage never breaks startup.

2. STARTUP AUTO-OPEN (App.tsx)
- Single mount effect that no-ops when a workspace or document is already loaded,
  so it cannot race the autosave effect or the beforeunload unsaved-changes guard.
- On mount: read the remembered path. If absent, do nothing (current first-run prompt).
- If present, run() openWorkspace(path) inside the existing busy/try/catch wrapper.
- On success: setWorkspace + status "Reopened <root>".
- On failure: forgetWorkspacePath(), setWorkspace(null), and show a non-alarming
  message ("Previous folder could not be opened. Choose a folder."). Do not throw.

3. PERSIST ON SELECTION (App.tsx chooseWorkspace)
- Only after openWorkspace succeeds, call saveWorkspacePath(selected).
- Demo mode: skip persistence entirely (see section 6).
- Never persist a path that failed to open.

4. STARTUP COST AND LOADING STATE
- Auto-open now runs reconcile() on every launch, which re-reads and re-indexes
  every Markdown file. This must not look like a hang.
- Add an explicit restoring state ("Reopening <folder>…") rendered before the
  workspace is ready, and keep the topbar buttons disabled while busy.
- If the folder is large, this is the first thing to profile; consider deferring
  reconcile or reporting progress in a follow-up, out of scope here.

5. FOLDER RENAME / MOVE — PRE-EXISTING DATA LOSS (do not ship auto-open without this)
- The SQLite database is keyed by content_hash(canonicalized root) at
  src-tauri/src/lib.rs:131. Renaming or moving the folder changes the hash, so
  Wrava creates a brand new empty database and all prior activity history is
  silently lost, leaving an apparently empty workspace.
- Minimum safe behaviour: when auto-open succeeds, compare the canonicalized root
  with the remembered path. If they differ, treat it as a different workspace and
  do not silently overwrite the history for the original path.
- Preferred fix, separate from this plan: persist a stable workspace identifier in
  the database (or a sidecar file keyed by a stable id) so history follows the
  folder across renames. Track as its own issue.

6. DEMO MODE
- Decided: skip persistence entirely when isDemoMode() is true.
- demoOpenWorkspace() ignores the path argument and always succeeds, so persisting
  would auto-open the demo workspace on every visit and mask the banner flow.

7. FORGET FOLDER ESCAPE HATCH
- Add a small "Forget folder" control next to the workspace path in the sidebar.
- Calls forgetWorkspacePath() and clears in-memory workspace state, returning the
  app to the first-run folder prompt without needing to pick a new folder.

8. PRIVACY AND SCOPE
- The path stays local in localStorage; nothing is uploaded.
- v0.1.x stores a single remembered folder only. A recent-folders list is
  deliberately out of scope but would suit users juggling several writing folders.
- Remembering the folder is implicit and always overridable via "Change folder".

9. TESTING CHECKLIST
- First run, no remembered folder: prompts as today.
- Select folder: loads, persists, "Change folder" still works.
- Relaunch: folder reopens automatically without the folder picker.
- Remembered folder deleted or moved: graceful fallback, prompt shown, path cleared.
- Remembered folder renamed: does not silently present an empty history (see 5).
- "Forget folder": returns to prompt, next launch does not auto-open.
- Demo mode: still shows the banner and starts unopened; nothing persisted.
- Large folder: shows restoring state, UI stays responsive, no double-open.

10. FILES TO MODIFY
- src/workspaceMemory.ts (new): key, load/save/forget helpers.
- src/App.tsx: mount effect, persist in chooseWorkspace, restoring state,
  "Forget folder" control.
- src-tauri/src/lib.rs: only if adopting the stable-workspace-id fix from section 5.