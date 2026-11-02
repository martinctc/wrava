import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStreaks } from "../src/writingStreaks.ts";
import type { DailyActivity } from "../src/types.ts";

function day(date: string, wordsAdded: number): DailyActivity {
  return { date, wordsAdded, wordsDeleted: 0, netChange: wordsAdded, activeDocuments: wordsAdded > 0 ? 1 : 0 };
}

test("counts a run ending today as the current streak", () => {
  const daily = [day("2026-01-01", 10), day("2026-01-02", 20), day("2026-01-03", 30)];
  assert.deepEqual(computeStreaks(daily), { current: 3, longest: 3 });
});

test("an inactive today does not break the current streak", () => {
  const daily = [day("2026-01-01", 10), day("2026-01-02", 20), day("2026-01-03", 0)];
  assert.deepEqual(computeStreaks(daily), { current: 2, longest: 2 });
});

test("an inactive yesterday ends the current run but not the longest", () => {
  const daily = [
    day("2026-01-01", 10),
    day("2026-01-02", 20),
    day("2026-01-03", 0),
    day("2026-01-04", 30),
  ];
  assert.deepEqual(computeStreaks(daily), { current: 1, longest: 2 });
});

test("handles an empty window and all-inactive days", () => {
  assert.deepEqual(computeStreaks([]), { current: 0, longest: 0 });
  assert.deepEqual(computeStreaks([day("2026-01-01", 0), day("2026-01-02", 0)]), { current: 0, longest: 0 });
});
