import type { DailyActivity } from "./types";

// Streak counting over daily activity, derived from existing analytics data
// (issue #10). A day "counts" when the writer added words on that calendar
// day. A streak runs over consecutive calendar days: an inactive today does
// not break the current streak (the day isn't over yet), but an inactive
// yesterday does. The longest streak is the longest run inside the window.
export type WritingStreaks = {
  current: number;
  longest: number;
};

export function computeStreaks(daily: readonly DailyActivity[]): WritingStreaks {
  if (!daily.length) return { current: 0, longest: 0 };
  // The window arrives newest-last; sort defensively rather than assume.
  const days = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let current = 0;
  let longest = 0;
  let run = 0;
  let currentFinalized = false;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].wordsAdded > 0) {
      run += 1;
      longest = Math.max(longest, run);
      if (!currentFinalized) current = run;
    } else {
      run = 0;
      // Only the window's final day gets the grace of being incomplete.
      currentFinalized = currentFinalized || i !== days.length - 1;
    }
  }
  return { current, longest };
}
