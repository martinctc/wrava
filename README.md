# Wrava

Wrava is a local-first desktop writing editor and activity tracker: a
lightweight "Strava for writing." Your writing stays in ordinary Markdown
files in a folder you control, while Wrava records additions and document
growth locally.

**[Try the live demo](https://martinctc.github.io/wrava/demo/)** in your
browser (no install, nothing is saved) · [Landing page](https://martinctc.github.io/wrava/)

|                                          |                                          |
| ---------------------------------------- | ---------------------------------------- |
| ![Write view](docs/screenshots/write.png) | ![Analytics view](docs/screenshots/analytics.png) |

![Welcome screen](docs/screenshots/welcome.png)

## Current vertical slice

- Select and index a folder of Markdown files.
- Give your writing its own title, stored as the first Markdown H1.
  New files suggest `yyyy-mm-dd_title-slug.md`, capped at 80 characters by default, including
  the date and extension. You can override this before creating the file.
- Edit the writing title or the smaller filename beneath it independently.
  Enter applies the change, Escape cancels. Title edits are saved with your
  writing, while filename changes are immediate. Neither renames the other.
  Existing files are never automatically renamed.
- Switch Light/Dark directly with the sun/moon icon beside Settings.
  Open Settings for appearance, autosave, editor text size,
  spellcheck language, and filename preferences. Settings are remembered on
  this device. Existing theme preferences are carried forward.
- Autosave is on by default and saves writing and tags after a two-second
  pause. Turn it off in Settings to save manually. Save and Ctrl+S still work
  immediately. Saving preserves the editor's cursor and undo history.
  A failed save keeps your draft and shows an error with a manual retry.
  The browser demo still saves only in memory, so reloading clears its writing.
- Adjust editor text size from 12 to 28 px in Settings (16 px by default).
  Both editors use the same size, without enlarging the rest of the interface.
- Spellcheck defaults to your Windows/browser settings. Choose British
  English (-ise spellings), US English, or Off. The explicit English options
  use bundled offline dictionaries in both the rich and Markdown editors,
  rather than relying on WebView2's system dictionary.
- Right-click an underlined word or place the cursor inside it and press
  Alt+Enter to see spelling suggestions. Corrections are opt-in and undoable.
  Code, Markdown front matter, URLs, email addresses and long non-prose tokens
  are excluded from the bundled checks.
- Filename preferences control the date prefix and maximum generated length
  (20–120 characters, 80 by default), with a live example. Only future
  suggestions change, never existing files or manually chosen names.
- Write in a WYSIWYG-style rich editor while saving ordinary Markdown.
- Switch to a complete Markdown source editor when direct control is needed.
- Use the focus icon beside the editor controls for more writing space.
  Press Escape to leave focus mode. Focus and Analytics use a compact activity
  summary instead of reserving space for the Write page's metric cards.
- Apply H1, H2, H3, bold, italic, underline, and link formatting.
- Add portable comma-separated tags stored in YAML front matter.
- Save files through the native application core.
- Reconcile changes made in other editors.
- Record words added, words deleted, and net document growth in SQLite.
- Show activity for today, this week, this month, and this year.
- Show the number of active documents alongside word activity.
- Explore a 12-week activity trend, consistency heatmap, and per-document
  and per-tag breakdowns on the detailed analytics page.

Existing files establish a zero-activity baseline when first indexed.

## Development

Prerequisites:

- Node.js 24 or later (for the built-in TypeScript test runner)
- Rust stable toolchain
- Windows prerequisites for Tauri 2

```powershell
npm install
npm run tauri dev
```

Run frontend helper tests with `npm test`, build with `npm run build`, and run
Rust tests with:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

The writing-controls browser regression runs with
`node tests\writingControls.browser.cjs` against a production preview on port
1421 (`npm run build`, then `npm run preview -- --port 1421`). It uses a
controllable desktop IPC stub for slow and failed saves. Set `WRAVA_PLAYWRIGHT`
to an installed `playwright-core` module and `WRAVA_BROWSER_PATH` to a Chromium
executable. These tools can live outside the project. `WRAVA_TEST_URL` overrides
the preview URL.

## Versioning and releases

Wrava follows [Semantic Versioning](https://semver.org/) and stays below
`1.0.0` while the core feature set is still settling. User-facing changes are
recorded in [NEWS.md](NEWS.md).

The version number must match across `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
`npm test` runs `scripts/check-version.mjs`, which fails if any of these
disagree, or if `NEWS.md` has no dated entry for the current version.

To cut a release:

1. Update the version in all four files above to the same value.
2. Move the `NEWS.md` `## Unreleased` items under a new
   `## <version> - <yyyy-mm-dd>` heading.
3. Run `npm test` to confirm the version and changelog are consistent.
4. Commit, merge to `master`, then tag the merge commit `v<version>` and push
   the tag. The `release` workflow builds and attaches the Windows MSI and
   NSIS installers automatically.

## Privacy

Wrava does not upload document contents or activity data. Markdown files remain
in the selected workspace. Derived activity data is stored in the operating
system's local application-data directory.

The bundled British and US spellcheck dictionaries run entirely on the device.
System-default spellchecking follows the host's spelling settings. Appearance,
spellcheck and filename preferences are saved locally. Dictionary and spelling
library licence notices are included in [public/licenses](public/licenses) and
in the built app.

## License

MIT
