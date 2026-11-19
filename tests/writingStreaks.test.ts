import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCurrentStreak,
  computeLongestStreak,
  computeStreaks,
  currentStreakDates,
} from "../src/writingStreaks.ts";
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

test("the longest streak is all-time, not bounded by the current window", () => {
  // A sparse set of active dates spanning far more than the 84-day window: an
  // old five-day run and a separate recent pair. This is the all-time view the
  // Rust core computes from the full event history, so `computeLongestStreak`
  // must find the older run of five even though it predates the window.
  const activeDates = [
    { date: "2026-01-01", wordsAdded: 5 },
    { date: "2026-01-02", wordsAdded: 5 },
    { date: "2026-01-03", wordsAdded: 5 },
    { date: "2026-01-04", wordsAdded: 5 },
    { date: "2026-01-05", wordsAdded: 5 },
    { date: "2026-06-01", wordsAdded: 5 },
    { date: "2026-06-02", wordsAdded: 5 },
  ];
  assert.equal(computeLongestStreak(activeDates), 5);
});

test("a duplicated date counts once toward the longest streak", () => {
  const days = [
    { date: "2026-01-01", wordsAdded: 5 },
    { date: "2026-01-02", wordsAdded: 5 },
    { date: "2026-01-02", wordsAdded: 9 },
    { date: "2026-01-03", wordsAdded: 5 },
  ];
  assert.equal(computeLongestStreak(days), 3);
});

test("the current streak is the trailing run of a dense window", () => {
  // A dense window: every calendar day is present, inactive days as 0. The
  // current streak is the trailing pair after the inactive day in the middle.
  const daily = [
    day("2026-01-01", 10),
    day("2026-01-02", 20),
    day("2026-01-03", 0),
    day("2026-01-04", 30),
    day("2026-01-05", 40),
  ];
  assert.deepEqual(computeStreaks(daily), { current: 2, longest: 2 });
});

test("two inactive days at the end leave no current streak", () => {
  const daily = [day("2026-01-01", 10), day("2026-01-02", 20), day("2026-01-03", 0), day("2026-01-04", 0)];
  assert.equal(computeCurrentStreak(daily), 0);
});

test("currentStreakDates lists the days in the current run, oldest first", () => {
  const daily = [
    day("2026-01-01", 10),
    day("2026-01-02", 20),
    day("2026-01-03", 0),
    day("2026-01-04", 30),
    day("2026-01-05", 0), // inactive today is forgiven
  ];
  assert.deepEqual(currentStreakDates(daily), ["2026-01-04"]);

  const active = [
    day("2026-01-01", 10),
    day("2026-01-02", 20),
    day("2026-01-03", 30),
  ];
  assert.deepEqual(currentStreakDates(active), ["2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.deepEqual(currentStreakDates([]), []);
});
