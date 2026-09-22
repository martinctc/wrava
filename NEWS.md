# Wrava release notes

This file tracks user-facing changes. Wrava follows [Semantic
Versioning](https://semver.org/); the version stays below `1.0.0` while the
core feature set is still settling.

## Unreleased

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
