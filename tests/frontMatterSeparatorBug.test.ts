// Regression guard for a REAL bug in the rich/source editor sync, now FIXED.
//
// `splitMarkdownDocument` treats a closing `---` at end-of-file as the end of the
// front matter block even when the file has no trailing newline, so the front matter
// of a metadata-only document does not end in a line break. Every place that joins the
// rich editor's body onto that block concatenated without a separator:
//
//   currentContent()     src/App.tsx:149   splitMarkdownDocument(content).frontMatter + richEditorRef.current.getMarkdown()
//   saveDocument()       src/App.tsx:322   splitMarkdownDocument(latest.content).frontMatter + richEditorRef.current.getMarkdown()
//   updateRichContent()  src/App.tsx:452   `${splitMarkdownDocument(current).frontMatter}${markdownBody}`
//
// The joined text turns the closing fence into `---\n---Hello.` style garbage that no
// longer parses as front matter, so the *next* split returns an empty frontMatter and
// the next save writes the document without its metadata. `withWritingTitle`
// (src/documentIdentity.ts) guards this exact case; the editor sync did not.
//
// The fix is the shared `joinMarkdownBody` helper, so `joinRichBody` below calls it
// instead of re-deriving the join. The three assertions are unchanged from the day they
// failed and still pin the exact bytes that reach the disk. They can only hold because
// the *join* inserts the separator: tests/documentIdentity.test.ts:124 requires the
// splitter to keep returning `---\ntags: [a]\n---` with no trailing newline, so
// normalising the closing fence inside `splitMarkdownDocument` is not an option. The
// two suites together force the newline into the join rather than into the split.
//
// SCOPE (updated when the editor UI was decomposed out of src/App.tsx): this guard used
// to read src/App.tsx by name, which silently narrowed it to one file the moment the UI
// was split up — a new join site in any sibling component would have gone unseen. It now
// walks every `src/**/*.ts` and `src/**/*.tsx`, so it covers wherever the join sites
// actually live. Two deliberate details keep that wider scope honest:
//
//   * `src/documentIdentity.ts` is excluded from the two negative assertions only. It is
//     the helper's own home, and its `withWritingTitle` legitimately contains
//     `${frontMatter}` — it inserts the same conditional newline by hand, which is the
//     behaviour `joinMarkdownBody` was written to share. That file was never in scope
//     before this change, so excluding it preserves the guard's original reach exactly
//     while strictly widening it to every other module in src/.
//   * `joinMarkdownBody(` is counted across ALL of src/ minus its own `function`
//     declaration in `documentIdentity.ts`, so the assertion is about *call sites*. The
//     real number is still 3 — currentContent(), saveDocument() and updateRichContent()
//     all stayed in src/App.tsx, which is why this refactor did not need to move any of
//     them. If a fourth join site ever appears anywhere in src/, this fails.
//
// Reachability: a hand-authored Markdown file that contains nothing but a YAML block
// and no trailing newline - e.g. `---\ntags: [essay]\n---`. Reading it in the rich
// editor and typing is enough. Wrava's folder is explicitly user-owned Markdown, and
// src-tauri/src/lib.rs (`front_matter`) disagreed with the TypeScript splitter on
// exactly this input, so the tags were also dropped from the sidebar on read.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { joinMarkdownBody, splitMarkdownDocument } from "../src/documentIdentity.ts";

// The rich editor owns the body; React `content` is the whole file (src/App.tsx:155).
const joinRichBody = (content: string, richBody: string) => joinMarkdownBody(content, richBody);

test("keeps the front matter block parseable when a rich body is joined onto a metadata-only document", () => {
  const file = "---\ntags: [essay]\n---\n".replace(/\n$/, "");
  assert.deepEqual(splitMarkdownDocument(file), { frontMatter: file, body: "" });

  const typed = joinRichBody(file, "Hello.\n");

  assert.equal(typed, "---\ntags: [essay]\n---\nHello.\n");
  assert.equal(splitMarkdownDocument(typed).frontMatter, "---\ntags: [essay]\n---\n");
});

test("does not drop the front matter block from the save that follows such an edit", () => {
  const file = "---\ntags: [essay]\n---\n".replace(/\n$/, "");
  const typed = joinRichBody(file, "Hello.\n");
  const liveRichBody = "Hello.\n";

  const submitted = `${splitMarkdownDocument(typed).frontMatter}${liveRichBody}`;

  assert.equal(submitted, "---\ntags: [essay]\n---\nHello.\n");
});

test("does not drop a CRLF front matter block from the save that follows such an edit", () => {
  const file = "---\r\ntags: [essay]\r\n---\r\n".replace(/\r\n$/, "");
  const typed = joinRichBody(file, "Hello.\n");

  assert.equal(typed, "---\r\ntags: [essay]\r\n---\r\nHello.\n");
  assert.equal(splitMarkdownDocument(typed).frontMatter, "---\r\ntags: [essay]\r\n---\r\n");
});

// ---------------------------------------------------------------------------------
// Coverage for the edges the fix must not regress.
// ---------------------------------------------------------------------------------

test("does not add a stray line feed to a CRLF document and never mixes line endings", () => {
  const file = "---\r\ntags: [essay]\r\n---";

  // The separator comes from the document, not from the body, which the rich editor
  // may hand over with LF endings of its own.
  assert.equal(joinMarkdownBody(file, "Hello.\n"), "---\r\ntags: [essay]\r\n---\r\nHello.\n");
  assert.equal(joinMarkdownBody(file, "Hello.\r\n"), "---\r\ntags: [essay]\r\n---\r\nHello.\r\n");
  assert.equal(joinMarkdownBody(file, ""), "---\r\ntags: [essay]\r\n---\r\n");
  assert.equal(joinMarkdownBody("---\r\ntags: [essay]\r\n---\r\n", "Hello.\r\n"),
    "---\r\ntags: [essay]\r\n---\r\nHello.\r\n");
  assert.doesNotMatch(joinMarkdownBody(file, "Hello.\r\n"), /(?<!\r)\n/);
});

test("leaves a document with no front matter completely untouched", () => {
  for (const source of ["", "\n", "Text only, no fences at all.\n", "# Title\n\nBody.\n",
    "---\n\nJust a rule\n", "---\r\ntags: [a]\r---\n# Mixed\r\n"]) {
    assert.equal(joinMarkdownBody(source, "Hello.\n"), "Hello.\n");
    assert.equal(joinMarkdownBody(source, ""), "");
  }
});

test("separates the halves exactly once, whatever state the front matter is in", () => {
  // Empty front matter: nothing to separate.
  assert.equal(joinMarkdownBody("", "Body.\n"), "Body.\n");
  // Already terminated by LF, and by CRLF: no second newline.
  assert.equal(joinMarkdownBody("---\ntags: [a]\n---\n", "Body.\n"), "---\ntags: [a]\n---\nBody.\n");
  assert.equal(joinMarkdownBody("---\r\ntags: [a]\r\n---\r\n", "Body.\r\n"), "---\r\ntags: [a]\r\n---\r\nBody.\r\n");
  // Closed at end-of-file: exactly one newline is inserted.
  assert.equal(joinMarkdownBody("---\ntags: [a]\n---", "Body.\n"), "---\ntags: [a]\n---\nBody.\n");
  assert.equal(joinMarkdownBody("---\r\ntags: [a]\r\n---", "Body.\n"), "---\r\ntags: [a]\r\n---\r\nBody.\n");
  // An empty body still yields a parseable, terminated block rather than bare fences.
  assert.equal(joinMarkdownBody("---\ntags: [a]\n---", ""), "---\ntags: [a]\n---\n");
  assert.equal(joinMarkdownBody("---\ntags: [a]\n---\n", ""), "---\ntags: [a]\n---\n");
});

test("recovers the same front matter and the same body on every split/join round trip", () => {
  const corpus = [
    "",
    "Body only.\n",
    "---\ntags: [a]\n---",
    "---\ntags: [a]\n---\n",
    "---\r\ntags: [a]\r\n---",
    "---\r\ntags: [a]\r\n---\r\n",
    "---\ntags: [a]\nauthor: Writer\n---\n# Notes\n\nKeep all of this.\n",
    "---\n\nIntro paragraph\n\n---\n\n## After\n",
    "---\ntags: [a]\n---\nOne\n\n---\n\nTwo\n",
  ];
  for (const source of corpus) {
    const { frontMatter, body } = splitMarkdownDocument(source);
    const joined = joinMarkdownBody(source, body);
    const recovered = splitMarkdownDocument(joined);
    // The only permitted drift is the single terminator the join had to add to a
    // block that ran to end-of-file; the metadata itself is never rewritten.
    assert.ok(recovered.frontMatter === frontMatter
      || recovered.frontMatter === `${frontMatter}${frontMatter.includes("\r\n") ? "\r\n" : "\n"}`,
    `front matter changed for ${JSON.stringify(source)}: ${JSON.stringify(recovered.frontMatter)}`);
    assert.equal(recovered.body, body);
    // Once terminated, the block stays byte-identical however often it is rejoined.
    assert.equal(joinMarkdownBody(joined, body), joined);
  }
});

test("every rich-body join site in src routes through the shared helper", () => {
  // The helper's own module also holds `withWritingTitle`, which interpolates front
  // matter on purpose; it is excluded from the two concatenation checks only.
  const helperModule = "documentIdentity.ts";
  const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
  const modules = readdirSync(fileURLToPath(new URL("../src", import.meta.url)), { recursive: true })
    .map(String)
    .filter((name) => /\.tsx?$/.test(name))
    .sort();
  assert.ok(modules.length > 1, "expected to scan every src module, not just one file");

  const callers = modules.map(source).join("\n");
  const ui = modules.filter((name) => name !== helperModule).map(source).join("\n");

  assert.doesNotMatch(ui, /\.frontMatter\s*\+/,
    "src concatenates front matter without a separator; use joinMarkdownBody");
  assert.doesNotMatch(ui, /\$\{frontMatter\}/,
    "src interpolates front matter without a separator; use joinMarkdownBody");
  // currentContent(), saveDocument(), updateRichContent() — excluding the declaration.
  assert.equal(callers.match(/(?<!function )joinMarkdownBody\(/g)?.length, 3);
});