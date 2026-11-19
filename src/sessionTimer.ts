// Pure countdown-timer logic for the optional writing-session timer.
//
// Everything time-dependent is a pure function of an explicit `nowMs`, so the
// behaviour can be tested without a real clock and stays correct when the tab
// is throttled in the background: a running timer counts down to a fixed end
// timestamp rather than decrementing a counter on each tick.

export const SESSION_PRESETS = [
  { label: "25 min (Pomodoro)", value: 25 },
  { label: "50 min (Deep work)", value: 50 },
] as const;

// Bounds for a custom duration, in whole minutes. A session is a focus aid, not
// a marathon: under a minute is a misclick, and past three hours the countdown is
// no longer a useful nudge.
export const MIN_SESSION_MINUTES = 1;
export const MAX_SESSION_MINUTES = 180;

export type TimerStatus = "idle" | "running" | "paused" | "finished";

export type TimerState = {
  /** Total length of this session, in whole seconds. */
  durationSeconds: number;
  /** Seconds left to display. Whole seconds, clamped at zero. */
  remainingSeconds: number;
  status: TimerStatus;
  /** Epoch milliseconds when a running timer reaches zero; null otherwise. */
  endAt: number | null;
};

function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 25;
  return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(minutes)));
}

/** A fresh, idle timer of the given length. */
export function createTimer(minutes: number): TimerState {
  const durationSeconds = clampMinutes(minutes) * 60;
  return { durationSeconds, remainingSeconds: durationSeconds, status: "idle", endAt: null };
}

/** Seconds left at `nowMs`, accounting for a running timer's fixed end. */
export function remainingAt(state: TimerState, nowMs: number): number {
  if (state.status === "running" && state.endAt !== null) {
    // Ceil so the display holds each second until it is fully elapsed and only
    // reaches 00:00 at the true end, rather than rounding away the final second.
    return Math.max(0, Math.ceil((state.endAt - nowMs) / 1000));
  }
  return state.remainingSeconds;
}

/** Starts or resumes the timer at `nowMs`. A finished timer restarts in full. */
export function startTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status === "running") return state;
  const seconds = state.remainingSeconds > 0 ? state.remainingSeconds : state.durationSeconds;
  return { ...state, remainingSeconds: seconds, status: "running", endAt: nowMs + seconds * 1000 };
}

/** Pauses a running timer, freezing the seconds left at `nowMs`. */
export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status !== "running") return state;
  const remainingSeconds = remainingAt(state, nowMs);
  return {
    ...state,
    remainingSeconds,
    status: remainingSeconds > 0 ? "paused" : "finished",
    endAt: null,
  };
}

/** Returns a running timer to idle for the same duration; a no-op otherwise. */
export function resetTimer(state: TimerState): TimerState {
  return { ...state, remainingSeconds: state.durationSeconds, status: "idle", endAt: null };
}

/**
 * Advances a running timer to `nowMs`. Returns the same object when nothing
 * observable changed, so a React setter can skip a re-render. Reaching zero
 * moves the timer to `finished`, which is the cue to notify the writer.
 */
export function tickTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status !== "running") return state;
  const remainingSeconds = remainingAt(state, nowMs);
  if (remainingSeconds <= 0) {
    return { ...state, remainingSeconds: 0, status: "finished", endAt: null };
  }
  if (remainingSeconds === state.remainingSeconds) return state;
  return { ...state, remainingSeconds };
}

/** Elapsed fraction in [0, 1], for a progress bar or ring. */
export function sessionProgress(state: TimerState): number {
  if (state.durationSeconds <= 0) return 0;
  const elapsed = state.durationSeconds - state.remainingSeconds;
  return Math.min(1, Math.max(0, elapsed / state.durationSeconds));
}

/** Formats a whole number of seconds as MM:SS, or H:MM:SS past an hour. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}