ACTION PLAN — Remember last workspace folder, and the review follow-ups

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

11. REVIEW FINDINGS AND HOW THEY WERE RESOLVED
- Dark mode was broken for the new Forget button: it hard-coded light-mode text,
  border and focus colours, so its hover state was invisible on the dark
  sidebar. Now driven by --dark-muted, --dark-border and --dark-accent.
- Any startup failure permanently forgot the folder. An offline network drive, a
  sync tool holding a lock or a database error all cleared the preference.
  isMissingFolderError() now only clears it when the backend reports the folder
  itself is missing; anything else is kept and retried next launch, with an
  explicit opt-out on the welcome panel.
- That classification originally matched substrings of the operating system's
  message text, which is localised: on a non-English Windows it never matched a
  folder that really had been deleted, and any unrelated error containing "not a
  directory" cleared it regardless. open_workspace now returns a code beside the
  message, derived from the underlying io::ErrorKind, and the frontend reads the
  code instead of the wording.
- A dead error path: the failure message from saveWorkspacePath was overwritten by
  the success status one line later. The two are now composed into one status.
- npm test failed on master. scripts/check-version.mjs matched
  `name = "wrava"\nversion = "..."` in Cargo.lock, but Cargo.toml and Cargo.lock
  are CRLF, so the literal \n never matched and the Cargo package version was
  reported as missing. The patterns now use \r?\n. cargoPackageVersion only passed
  by accident (its [^[]*? happened to consume the \r) and is made explicit too.
- No workflow ran any test: both existing workflows only built while the PR
  template asked contributors to confirm the suites by hand. Added a Test
  workflow on pull requests, pushes to master and manual dispatch.
- The new CI caught a bug in the new licence check on its first run.
  scripts/check-licenses.mjs read node_modules/dictionary-en/LICENSE while the
  package ships `license`. That resolved on the case-insensitive filesystem it
  was written on and failed with ENOENT on the Linux runner. Candidates are now
  resolved against the directory entries that actually exist; three of the four
  bundled packages ship a lowercase `license` and only is-buffer ships an
  uppercase LICENSE. Worth remembering as the reason the licence check gets a
  Linux job rather than a Windows one.
- read_identity accepted any wrava.json carrying a non-empty id, so an unrelated
  program using the same filename would have its id adopted and the activity
  database migrated onto it. Identities now carry a marker field Wrava writes,
  and `deny_unknown_fields` rejects anything carrying further keys, which keeps
  the bare {id, root} written by an earlier build working. Those are stamped with
  the marker the first time the folder is refreshed, so the upgrade needs no
  second pass.

12. DESIGN DECISIONS FOR THE PART 2 WORK
- The front matter fix lives in the join, not the split. withWritingTitle already
  guarded this exact hazard by inserting a missing newline; the editor join sites
  did not. A single joinMarkdownBody helper is now shared by all three join sites
  so the separator cannot be re-derived per call site. splitMarkdownDocument is
  deliberately unchanged: normalising the fence there would contradict the
  round-trip contract the characterisation suite pins.
- Search parity: the demo backend and the Rust command share the same two-character
  floor and the same case-insensitive body match, so they cannot disagree. The
  listing and the search share one walker, so they cannot drift on which files are
  visible.
- Search races: results carry the query that produced them and are only accepted
  while that query is still in the box, so a slow response cannot answer a phrase
  the user has typed past. While a search is pending the sidebar shows filename
  matches only — briefly incomplete rather than wrong.
- Decomposition boundary: only presentational leaves were extracted. The sidebar,
  topbar and document header take 9–15 props each and would have required context
  or a reducer, which the project has no other use for. Passing props is the
  better trade until there is a reason not to.
- Path hardening: traversal is still decided per component, so legitimate names
  such as draft..notes.md keep working. A textual check for .. would reject them
  and was explicitly rejected.

13. KNOWN ISSUES LEFT OPEN (none covered by a test)
- The browser regression harness still does not run in CI. It is the only real
  UI coverage, and it now carries the content-search assertions. It needs
  playwright-core plus a browser download, which is why it is excluded from the
  Test workflow rather than included. Worth doing next.
- The CSV export uses # section markers. The four datasets have incompatible
  columns, so the file stacks five sections separated by "# <title>" lines. Those
  markers are not valid CSV data records: a naive csv.DictReader trips on them,
  and Excel may show them as junk rows. Emitting one file per dataset, or a
  single wide table, would trade away the sectioning. The parsing contract is
  documented at the top of src/analyticsExport.ts.
- The CSV export has no formula-injection guard. A document path or two-word
  phrase beginning with =, +, - or @ will execute as a formula when the file is
  opened in Excel. This was left unmitigated on purpose — prefix-escaping would
  break the round-trip fidelity the tests assert and would silently corrupt real
  data — but it is a real risk and needs a decision.
- The blob download is verified in Chromium, but the shipped app runs in Tauri's
  WebView2, where a download may be intercepted by the webview rather than
  written to disk. That path is unverified. The clipboard copy exists as a
  fallback and the status line says so when a download does not appear.
- Startup runs reconcile() on every launch, which re-reads every Markdown file. A
  restoring state is shown so this does not look like a hang, but large folders
  may still be slow.
- Scope: a single remembered folder. A recent-folders list is deliberately out of
  scope for now.
- cargo fmt --check reports 15 pre-existing formatting differences in lib.rs
  that predate this work and were left alone.