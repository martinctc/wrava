import assert from "node:assert/strict";
import test from "node:test";
import {
  documentFilename, suggestedFilename, writingTitle, withWritingTitle, splitMarkdownDocument, titleMarkdown,
} from "../src/documentIdentity.ts";

const date = new Date(2026, 8, 18, 12);

test("validates custom file names separately from writing titles", () => {
  assert.equal(documentFilename("my-notes.mD"), "my-notes.md");
  assert.equal(documentFilename(" My notes "), "My notes.md");
  for (const name of ["CON", "con.notes.md", "bad\nname", "../outside", "Why?", " ".repeat(10), "a".repeat(253)]) {
    assert.throws(() => documentFilename(name));
  }
});

test("suggests local-date-prefixed slugs independent of the writing title", () => {
  assert.equal(suggestedFilename("Reflections on Discipline", date), "2026-09-18_reflections-on-discipline.md");
  assert.equal(suggestedFilename("  Café: Why / Now?  ", date), "2026-09-18_cafe-why-now.md");
  assert.equal(suggestedFilename("???", date), "2026-09-18_untitled.md");
  assert.equal(suggestedFilename("考察", date), "2026-09-18_考察.md");
  for (const title of ["a".repeat(500), "long words ".repeat(100), "𐐀".repeat(100)]) {
    const name = suggestedFilename(title, date);
    assert.ok(Array.from(name).length <= 80);
    assert.ok(name.endsWith(".md"));
    assert.ok(!name.endsWith("-.md"));
    assert.match(name, /^2026-09-18_/);
  }
});

test("reads the first real heading, ignoring YAML, fenced code and nested headings", () => {
  assert.equal(writingTitle("---\ntitle: Metadata\n---\n```\n# Code\n```\n# Real **title**\n\n# Later"), "Real title");
  assert.equal(writingTitle("~~~\n# Not a title\n~~~\nText"), "");
  assert.equal(writingTitle("> # Quoted\n\nTitle\n=====\n"), "Title");
  assert.equal(writingTitle("# A [linked](https://example.com) title"), "A linked title");
});

test("updates only the first heading and preserves body and metadata", () => {
  const source = "---\ntags: [essay]\nauthor: Writer\n---\n# Old\n\nKeep **all** this.\n\n# Second\n";
  const result = withWritingTitle(source, "Reflections on Discipline");
  assert.equal(result, source.replace("# Old", "# Reflections on Discipline"));
  assert.equal(writingTitle(result), "Reflections on Discipline");
  assert.equal(withWritingTitle("Old\r\n===\r\n\r\nBody", "New"), "# New\r\n\r\nBody");
  assert.equal(withWritingTitle("---\ntags: [a]\n---", "New"), "---\ntags: [a]\n---\n# New\n\n");
  assert.equal(withWritingTitle("Body without heading", "New"), "# New\n\nBody without heading");
  assert.deepEqual(splitMarkdownDocument("---\ntags: [a]\n---\nBody"), { frontMatter: "---\ntags: [a]\n---\n", body: "Body" });
});

test("titles accept file-name-reserved characters and preserve literal Markdown", () => {
  const title = "Why: *this* [title] <today> # _now_ \\";
  assert.equal(writingTitle(withWritingTitle("# Before\n", title)), title);
  assert.equal(titleMarkdown("Reflections on Discipline"), "Reflections on Discipline");
  assert.throws(() => titleMarkdown("   "), /single line/);
  assert.throws(() => titleMarkdown("First\nSecond"), /single line/);
});

test("round-trips front matter through repeated rich-editor bodies without duplicating or dropping it", () => {
  const file = "---\ntags: [essay]\nauthor: Writer\n---\n# Notes\n\nKeep all of this.\n";
  const { frontMatter, body } = splitMarkdownDocument(file);
  assert.deepEqual({ frontMatter, body }, {
    frontMatter: "---\ntags: [essay]\nauthor: Writer\n---\n",
    body: "# Notes\n\nKeep all of this.\n",
  });
  let content = file;
  for (let edit = 0; edit < 5; edit += 1) {
    const richBody = `# Notes\n\nKeep all of this. Edit ${edit}.\n`;
    content = `${splitMarkdownDocument(content).frontMatter}${richBody}`;
    assert.deepEqual(splitMarkdownDocument(content), { frontMatter, body: richBody });
    assert.equal(content.split("tags: [essay]").length - 1, 1);
  }
  assert.equal(splitMarkdownDocument(content).frontMatter, frontMatter);
});

test("keeps the whole document as body when it has no front matter", () => {
  for (const source of ["", "Text only, no fences at all.\n", "A --- inside a line.\n", "# Title\n\nBody.\n", "---\n\nJust a rule\n"]) {
    assert.deepEqual(splitMarkdownDocument(source), { frontMatter: "", body: source });
  }
  assert.equal(splitMarkdownDocument("---\n\nJust a rule\n").frontMatter + splitMarkdownDocument("---\n\nJust a rule\n").body,
    "---\n\nJust a rule\n");
});

test("swallows a leading horizontal rule and the text up to the next one into the front matter", () => {
  const source = "---\n\nIntro paragraph\n\n---\n\n## After\n";
  assert.deepEqual(splitMarkdownDocument(source), {
    frontMatter: "---\n\nIntro paragraph\n\n---\n",
    body: "\n## After\n",
  });
  assert.deepEqual(splitMarkdownDocument("---\nrule\n---\ntext\n"), {
    frontMatter: "---\nrule\n---\n",
    body: "text\n",
  });
  const { frontMatter, body } = splitMarkdownDocument(source);
  assert.equal(frontMatter + body, source);
  assert.deepEqual(splitMarkdownDocument(frontMatter + body), { frontMatter, body });
});

test("keeps front matter whole when the body itself contains horizontal rules", () => {
  const source = "---\ntags: [a]\n---\nOne\n\n---\n\nTwo\n";
  const { frontMatter, body } = splitMarkdownDocument(source);
  assert.deepEqual({ frontMatter, body }, { frontMatter: "---\ntags: [a]\n---\n", body: "One\n\n---\n\nTwo\n" });
  assert.deepEqual(splitMarkdownDocument(frontMatter + body), { frontMatter, body });
});

test("round-trips CRLF documents without normalizing line endings", () => {
  const source = "---\r\ntags: [a]\r\n---\r\n# Title\r\n\r\nBody line\r\n";
  const { frontMatter, body } = splitMarkdownDocument(source);
  assert.deepEqual({ frontMatter, body }, {
    frontMatter: "---\r\ntags: [a]\r\n---\r\n",
    body: "# Title\r\n\r\nBody line\r\n",
  });
  assert.equal(frontMatter + body, source);
  assert.equal(splitMarkdownDocument(frontMatter + body).frontMatter, frontMatter);
  assert.deepEqual(splitMarkdownDocument("# Title\r\n\r\nBody\r\n"), { frontMatter: "", body: "# Title\r\n\r\nBody\r\n" });
  assert.deepEqual(splitMarkdownDocument("---\r\ntags: [a]\r\n---\r\n\r\n---\r\n\r\nRule\r\n"), {
    frontMatter: "---\r\ntags: [a]\r\n---\r\n",
    body: "\r\n---\r\n\r\nRule\r\n",
  });
  const loneCarriageReturns = "---\rtags: [a]\r---\n# Mixed\r\n";
  assert.deepEqual(splitMarkdownDocument(loneCarriageReturns), { frontMatter: "", body: loneCarriageReturns });
});

test("handles empty, front-matter-only and title-only documents", () => {
  assert.deepEqual(splitMarkdownDocument(""), { frontMatter: "", body: "" });
  assert.deepEqual(splitMarkdownDocument("---\ntags: [a]\n---"), { frontMatter: "---\ntags: [a]\n---", body: "" });
  assert.deepEqual(splitMarkdownDocument("---\ntags: [a]\n---\n"), { frontMatter: "---\ntags: [a]\n---\n", body: "" });
  assert.deepEqual(splitMarkdownDocument("---\r\ntags: [a]\r\n---"), { frontMatter: "---\r\ntags: [a]\r\n---", body: "" });
  assert.equal(writingTitle(""), "");
  assert.equal(writingTitle("---\ntags: [a]\n---"), "");
  assert.equal(writingTitle("---\ntags: [a]\n---\n"), "");
  assert.equal(withWritingTitle("", "New"), "# New\n\n");
  assert.equal(withWritingTitle("---\ntags: [a]\n---\n", "New"), "---\ntags: [a]\n---\n# New\n\n");
  assert.equal(withWritingTitle(withWritingTitle("---\ntags: [a]\n---\n# Old\n", "New"), "New"),
    "---\ntags: [a]\n---\n# New\n");
});

test("round-trips unicode titles and bodies through the heading helpers", () => {
  const title = "考察 — Café 🎉 *bold* #now";
  assert.equal(writingTitle(withWritingTitle("---\ntags: [a]\n---\n# Old\n\nBody 🎉\n", title)), title);
  assert.equal(withWritingTitle("---\r\ntags: [a]\r\n---\r\n# Old\r\n\r\n本文 🎉\r\n", "新題 🎉"),
    "---\r\ntags: [a]\r\n---\r\n# 新題 🎉\r\n\r\n本文 🎉\r\n");
  assert.equal(writingTitle("# 👩‍💻🏳️‍🌈 family emoji"), "👩‍💻🏳️‍🌈 family emoji");
  assert.equal(writingTitle("# Cafe\u0301 decomposed"), "Cafe\u0301 decomposed");
  assert.equal(withWritingTitle("# e\u0301\n", "e\u0301"), "# e\u0301\n");
  assert.deepEqual(splitMarkdownDocument("---\ntags: [a]\n---\n本文 🎉\n"), {
    frontMatter: "---\ntags: [a]\n---\n",
    body: "本文 🎉\n",
  });
});

test("round-trips suggested file names back through the document file name check", () => {
  for (const title of ["Café: Why / Now?", "考察", "🎉", "con", "Ünïcödé — em—dash"]) {
    const suggestion = suggestedFilename(title, date);
    assert.equal(documentFilename(suggestion), suggestion);
    assert.ok(suggestion.endsWith(".md"));
  }
  assert.equal(suggestedFilename("🎉", date), "2026-09-18_untitled.md");
  assert.equal(suggestedFilename("Café: Why / Now?", date, { includeDate: false, maxLength: 80 }), "cafe-why-now.md");
  assert.equal(suggestedFilename("Alpha beta gamma", date, { includeDate: false, maxLength: 12 }), "alpha-bet.md");
  assert.ok(suggestedFilename("A very long essay title that will certainly need shortening", date,
    { includeDate: true, maxLength: 20 }).length <= 20);
});
