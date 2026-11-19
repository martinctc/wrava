import type { DailyActivity } from "./types";

// Streak counting (issue #10), derived from existing analytics data. A day
// "counts" when the writer added words on it. The two streaks answer different
// questions, and the Rust core (src-tauri/src/lib.rs) mirrors this exactly:
//
//   * current — how long is the active run right now. An inactive today does not
//     break it (the day isn't over yet), but an inactive yesterday does. Computed
//     over the recent daily window, which always ends at today.
//   * longest — the all-time best run, over the full set of active days the
//     caller can see, so a run older than the analytics window still counts.

export type WritingStreaks = {
  current: number;
  longest: number;
};

/** The active run ending at (or, if today is inactive, just before) the window. */
export function computeCurrentStreak(daily: readonly DailyActivity[]): number {
  if (!daily.length) return 0;
  // The window arrives newest-last; sort defensively rather than assume.
  const days = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let current = 0;
  let finalized = false;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].wordsAdded > 0) {
      if (!finalized) current += 1;
    } else if (i !== days.length - 1) {
      // Only the window's final day (today) is forgiven as incomplete.
      finalized = true;
    }
  }
  return current;
}

/**
 * The longest run of consecutive active calendar days across the given days.
 * Pass the full history (not just the window) for an all-time figure; the Rust
 * core computes this from every recorded activity event.
 */
export function computeLongestStreak(days: readonly { date: string; wordsAdded: number }[]): number {
  const activeDates = [...new Set(
    days.filter((day) => day.wordsAdded > 0).map((day) => day.date),
  )].sort();
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const date of activeDates) {
    const time = Date.parse(`${date}T00:00:00Z`);
    run = previous !== null && time - previous === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = time;
  }
  return longest;
}

/** Convenience: both streaks from a single daily window (used by the demo). */
export function computeStreaks(daily: readonly DailyActivity[]): WritingStreaks {
  return { current: computeCurrentStreak(daily), longest: computeLongestStreak(daily) };
}

/**
 * The calendar dates that make up the current streak, newest-last, so a
 * calendar/grid can highlight exactly the run the writer is on. Applies the
 * same grace as `computeCurrentStreak`: an inactive today is skipped, and the
 * run is the consecutive active days ending at today or yesterday.
 */
export function currentStreakDates(daily: readonly DailyActivity[]): string[] {
  const days = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const inStreak: string[] = [];
  let graceAvailable = true;
  for (let i = days.length - 1; i >= 0; i--) {
    const isLast = i === days.length - 1;
    if (days[i].wordsAdded > 0) {
      inStreak.push(days[i].date);
    } else if (isLast && graceAvailable) {
      // Today isn't over yet; forgive it once and keep looking back.
      graceAvailable = false;
    } else {
      break;
    }
  }
  return inStreak.reverse();
}