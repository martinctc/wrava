import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_SEARCH_DEBOUNCE_MS,
  MIN_CONTENT_SEARCH_CHARS,
  filterDocuments,
  normalizeSearchQuery,
  shouldSearchContent,
} from "../src/documentSearch.ts";

const files = [
  "2026-09-10 Morning pages.md",
  "2026-09-12 Essay on slow productivity.md",
  "2026-09-15 Novel outline.md",
  "2026-09-16 Book notes.md",
];

test("a document matching only its file name is listed", () => {
  assert.deepEqual(filterDocuments(files, "outline", []), ["2026-09-15 Novel outline.md"]);
});

test("a document found only in its body is listed", () => {
  const content = ["2026-09-16 Book notes.md"];
  assert.deepEqual(filterDocuments(files, "harbourmaster", content), content);
});

test("a document matching by name and by body is listed once", () => {
  assert.deepEqual(
    filterDocuments(files, "book notes", ["2026-09-16 Book notes.md"]),
    ["2026-09-16 Book notes.md"],
  );
});

test("matching ignores case on both sides of the query", () => {
  const content = ["2026-09-15 Novel outline.md"];
  assert.deepEqual(filterDocuments(files, "OUTLINE", content), ["2026-09-15 Novel outline.md"]);
  assert.deepEqual(filterDocuments(files, "HARBOURMASTER", content), content);
});

test("an empty or whitespace query restores the unfiltered list in order", () => {
  assert.deepEqual(filterDocuments(files, "", ["2026-09-15 Novel outline.md"]), files);
  assert.deepEqual(filterDocuments(files, "   ", []), files);
});

test("a body hit surfaces a document whose name shares nothing with the query", () => {
  // "The harbourmaster keeps her own record." lives in Book notes.md; the word
  // appears nowhere in any file name, so the file-name filter alone finds nothing.
  const content = ["2026-09-16 Book notes.md"];
  assert.deepEqual(
    files.filter((path) => path.toLowerCase().includes("harbourmaster")),
    [],
    "the premise of the feature: a name-only filter misses this",
  );
  assert.deepEqual(filterDocuments(files, "harbourmaster", content), content);
});

test("content matches for documents no longer in the folder are dropped", () => {
  const shown = files.slice(1);
  assert.deepEqual(
    filterDocuments(shown, "harbourmaster", ["2026-09-10 Morning pages.md", "2026-09-16 Book notes.md"]),
    ["2026-09-16 Book notes.md"],
  );
});

test("the displayed order follows the folder, not the match order", () => {
  // "Novel outline.md" has no "s" in its name, so it is listed only because the
  // backend found one in its body — and it still holds its place in the folder order.
  assert.deepEqual(
    filterDocuments(files, "s", ["2026-09-15 Novel outline.md"]),
    ["2026-09-10 Morning pages.md", "2026-09-12 Essay on slow productivity.md",
      "2026-09-15 Novel outline.md", "2026-09-16 Book notes.md"],
  );
  assert.deepEqual(
    filterDocuments(["b.md", "a.md"], "notes", ["a.md"]),
    ["a.md"],
    "a content hit takes the position the sort gave it",
  );
});

test("a query is normalised once, as lowercase and trimmed", () => {
  assert.equal(normalizeSearchQuery("  Slow PROD  "), "slow prod");
});

test("content search waits for a query worth walking the workspace for", () => {
  assert.equal(shouldSearchContent(""), false);
  assert.equal(shouldSearchContent(" a "), false);
  assert.equal(shouldSearchContent("ab"), true);
  assert.equal(shouldSearchContent("a".repeat(MIN_CONTENT_SEARCH_CHARS)), true);
  assert.ok(DOCUMENT_SEARCH_DEBOUNCE_MS > 0, "the debounce is a real wait");
});
