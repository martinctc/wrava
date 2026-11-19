# Wrava release notes

This file tracks user-facing changes. Wrava follows [Semantic
Versioning](https://semver.org/); the version stays below `1.0.0` while the
core feature set is still settling.

## Unreleased

### Added

- Writing streaks on the Analytics page: a current-streak and an all-time
  longest-streak summary, plus the current run outlined on the consistency
  calendar. A day counts when you added words; an inactive today doesn't break
  the streak, and the longest streak is computed from your full history rather
  than the 12-week window.
- An optional writing-session timer: turn it on in Settings → Writing and a
  Pomodoro-style countdown appears in the topbar. Pick a 25- or 50-minute preset
  or a custom length, then start, pause, resume, or reset it; a progress bar fills
  as the session runs and a quiet message marks its end. Nothing is recorded or
  enforced, and it stays out of the way until you start it.
- An optional emotional check-in: turn it on in Settings → Writing and a mood
  picker appears above the editor. Choose how a session felt and add an optional
  note; both are saved as `emotion` and `emotion_reason` in the document's front
  matter, alongside its tags. Existing documents are unaffected until you pick a
  mood, and choosing "No check-in" clears it again.
- An editor font control in Settings (Settings → Writing) to switch both editors
  between the system default, a serif, and a monospace face. The live preview
  shows the chosen font at the current text size.

## 0.1.2 - 2026-10-12

### Added

- Reopens the last used writing folder on startup, with a Forget folder control
  to clear it. Only the folder path is remembered, and never in the browser demo.
- Activity history now survives renaming or moving a writing folder. Wrava
  writes a small `wrava.json` into the folder holding a stable id, and keys its
  local database by that id instead of the folder path. A copied folder is given
  its own history rather than sharing one.
- Deeper text analytics: a "Writing patterns" card on the analytics page shows
  the most frequent two-word pairs in the workspace, with stopwords removed.
- The document search box now matches the text inside documents as well as
  their filenames. Front matter is not searched, so a query no longer matches a
  document merely because it carries a tag.
- The analytics page can export its data as CSV or JSON, or copy the CSV to the
  clipboard.

### Fixed

- Editing a document that contained only a YAML front matter block, and had no
  trailing newline, could write the file back without its front matter. The
  tags were then missing from the sidebar and the analytics. Existing documents
  are repaired the next time they are saved.

## 0.1.1 - 2026-09-27

### Added

- Optional daily, weekly, monthly and yearly net-growth goals, with progress,
  weekly average and the pace needed to reach a weekly target.
- A newest/oldest filename-date document sort control and preference.

### Changed

- Today and this week lead the Write-page activity summary. Month and year
  totals are available in a collapsible section, and net growth is labelled
  clearly instead of as document growth.

## 0.1.0 - 2026-09-22

### Added

- Local-first Markdown writing tracker with a WYSIWYG rich editor and a full
  Markdown source editor.
- Word-activity tracking, with daily/weekly/monthly/yearly totals and a
  12-week trend, consistency heatmap, and per-document and per-tag
  breakdowns.
- Portable comma-separated tags stored in YAML front matter.
- Focus mode, reachable from a small icon beside the editor, that reclaims
  space normally used by the compact activity summary.
- Independent writing titles and filenames. New files suggest a
  date-prefixed slug from the title; editing the title afterwards never
  renames the file, and editing the filename never changes the title.
- A discreet Settings panel covering appearance, spellcheck and filename
  preferences.
- Light and Dark appearance, with a header shortcut to switch instantly.
- Offline British and US English spellchecking in both editors, with
  right-click/Alt+Enter suggestions. Corrections are always opt-in.
- Autosave, enabled by default, saving writing and tags after a short pause.
  Can be turned off in Settings; Ctrl+S always saves immediately.
- An editor-only text-size slider (12-28px) that leaves the rest of the
  interface unchanged.
- A browser-based interactive demo and landing page, published to GitHub
  Pages, with sample documents and seeded analytics.
- Windows MSI and NSIS installers, published automatically from tagged
  releases.
