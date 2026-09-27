import type { ActivityStats } from "./types";

export type GoalPeriod = "today" | "week" | "month" | "year";
export type WritingGoals = Record<GoalPeriod, number>;

export const emptyGoals: WritingGoals = { today: 0, week: 0, month: 0, year: 0 };

export function goalProgress(net: number, goal: number): number {
  return goal === 0 ? 0 : Math.min(100, Math.max(0, net / goal * 100));
}

export function weekPace(stats: ActivityStats, today: Date): { average: number; needed: number } {
  const dayOfWeek = (today.getDay() + 6) % 7;
  return {
    average: Math.round(stats.weekNet / (dayOfWeek + 1)),
    needed: 7 - dayOfWeek,
  };
}

function filenameDate(path: string): string | null {
  const name = path.split(/[/\\]/).pop() ?? path;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?=[_. -])/.exec(name);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
}

export function sortDocuments(files: string[], order: "newest" | "oldest"): string[] {
  const direction = order === "newest" ? -1 : 1;
  return [...files].sort((left, right) => {
    const leftDate = filenameDate(left);
    const rightDate = filenameDate(right);
    if (leftDate && rightDate && leftDate !== rightDate) {
      return leftDate < rightDate ? -direction : direction;
    }
    if (leftDate !== rightDate) return leftDate ? -1 : 1;
    return direction * left.localeCompare(right, undefined, { sensitivity: "base" });
  });
}
