import assert from "node:assert/strict";
import test from "node:test";
import { goalProgress, sortDocuments, weekPace } from "../src/writingProgress.ts";
import { emptyStats } from "../src/types.ts";

test("progress clamps negative growth and goals exceeded while retaining numeric totals", () => {
  assert.equal(goalProgress(-50, 400), 0);
  assert.equal(goalProgress(100, 400), 25);
  assert.equal(goalProgress(500, 400), 100);
  assert.equal(goalProgress(0, 0), 0);
});

test("weekly pace divides by elapsed calendar days, including days without writing", () => {
  assert.deepEqual(weekPace({ ...emptyStats, weekNet: 400 }, new Date(2026, 8, 27)),
    { average: 57, needed: 1 });
  assert.deepEqual(weekPace({ ...emptyStats, weekNet: -5 }, new Date(2026, 8, 21)),
    { average: -5, needed: 7 });
});

test("filename dates sort newest or oldest first with undated files last", () => {
  const files = ["notes.md", "2026-09-12_essay.md", "2026-09-27_daily.md",
    "2026-09-12_other.md", "drafts/2026-09-15_note.md", "2026-02-30_bad.md"];
  assert.deepEqual(sortDocuments(files, "newest"), [
    "2026-09-27_daily.md", "drafts/2026-09-15_note.md", "2026-09-12_other.md",
    "2026-09-12_essay.md", "notes.md", "2026-02-30_bad.md",
  ]);
  assert.deepEqual(sortDocuments(files, "oldest"), [
    "2026-09-12_essay.md", "2026-09-12_other.md", "drafts/2026-09-15_note.md",
    "2026-09-27_daily.md", "2026-02-30_bad.md", "notes.md",
  ]);
  assert.equal(files[0], "notes.md");
});
