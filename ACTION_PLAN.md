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
- On failure: classify the error with isMissingFolderError().
  - Genuinely missing folder: forgetWorkspacePath(), setWorkspace(null), and
    show a non-alarming message ("Your last folder is no longer available.
    Choose a folder.").
  - Anything else (offline network drive, sync lock, database error): keep the
    remembered path so the next launch retries, leave the app on the folder
    prompt, and offer a "Stop reopening the last folder" link.
  - Never clear the path on an unclassified failure. Do not throw either way.

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

5. FOLDER RENAME / MOVE — HISTORY FOLLOWS THE FOLDER (resolved)
- The original problem: the SQLite database was keyed by
  content_hash(canonicalized root) at src-tauri/src/lib.rs, so renaming or moving
  the folder changed the hash, Wrava created a brand new empty database, and all
  prior activity history stopped being shown.
- Resolved: Wrava writes wrava.json into the writing folder holding a stable id
  plus the folder's current canonical location, and keys the database by that id
  instead of the path. A rename or move keeps its history.
- Copy detection: if the recorded location in wrava.json still exists somewhere
  else, the folder is a copy rather than a move, so it is given a fresh id. Two
  folders never share a single activity record.
- Migration: when a folder gains an identity, an existing path-keyed database is
  moved across to the new key so nothing is abandoned. If that move fails, the
  session stays on the old database and the move is retried next launch.
- Fallback: a read-only folder, or a wrava.json Wrava did not write, keeps the
  old path-derived key — exactly the pre-identity behaviour, never an error.
- Limitation: the id lives only in wrava.json. Deleting that file by hand makes
  the folder look new to Wrava; Wrava never deletes it itself.

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
- Remembered folder deleted: graceful fallback, prompt shown, path cleared.
- Remembered folder temporarily unreachable (offline drive, lock, database
  error): prompt shown, path kept for the next launch, opt-out link offered.
- Remembered folder renamed: does not silently present an empty history (see 5).
- "Forget folder": returns to prompt, next launch does not auto-open.
- Demo mode: still shows the banner and starts unopened; nothing persisted.
- Large folder: shows restoring state, UI stays responsive, no double-open.

10. FILES TO MODIFY
- src/workspaceMemory.ts (new): key, load/save/forget helpers.
- src/App.tsx: mount effect, persist in chooseWorkspace, restoring state,
  "Forget folder" control.
- src-tauri/src/lib.rs: only if adopting the stable-workspace-id fix from section 5.