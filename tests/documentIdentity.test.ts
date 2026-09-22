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
