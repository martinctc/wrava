import { useEffect, useReducer, useRef, useState } from "react";
import {
  createTimer,
  formatClock,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  pauseTimer,
  resetTimer,
  SESSION_PRESETS,
  sessionProgress,
  startTimer,
  tickTimer,
  type TimerState,
} from "./sessionTimer";

const CUSTOM = "custom";

type Action =
  | { type: "select"; minutes: number }
  | { type: "toggle"; now: number }
  | { type: "reset" }
  | { type: "tick"; now: number };

function reducer(state: TimerState, action: Action): TimerState {
  switch (action.type) {
    case "select":
      return createTimer(action.minutes);
    case "toggle":
      return state.status === "running"
        ? pauseTimer(state, action.now)
        : startTimer(state, action.now);
    case "reset":
      return resetTimer(state);
    case "tick":
      return tickTimer(state, action.now);
  }
}

/**
 * An optional writing-session timer for the topbar. It keeps its own state and
 * never touches the document: starting or finishing a session has no effect on
 * the writer's work. The end of a session is announced through `onFinish` so the
 * app can show a quiet status message.
 */
export function SessionTimer({ onFinish }: { onFinish: (message: string) => void }) {
  const [state, dispatch] = useReducer(reducer, SESSION_PRESETS[0].value, createTimer);
  const [choice, setChoice] = useState<string>(String(SESSION_PRESETS[0].value));
  const [customMinutes, setCustomMinutes] = useState("25");
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  // Tick only while running. Each tick re-reads the wall clock, so a throttled
  // background tab catches up correctly rather than drifting.
  useEffect(() => {
    if (state.status !== "running") return;
    const id = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 250);
    return () => window.clearInterval(id);
  }, [state.status]);

  // Announce completion once, on the transition into `finished`.
  const previousStatus = useRef(state.status);
  useEffect(() => {
    if (previousStatus.current === "running" && state.status === "finished") {
      finishRef.current("Writing session complete. Take a breath.");
    }
    previousStatus.current = state.status;
  }, [state.status]);

  const progress = sessionProgress(state);
  const running = state.status === "running";
  const active = state.status !== "idle";

  function selectPreset(value: string) {
    setChoice(value);
    if (value === CUSTOM) return;
    dispatch({ type: "select", minutes: Number(value) });
  }

  function applyCustom() {
    const minutes = Number(customMinutes);
    if (Number.isInteger(minutes) && minutes >= MIN_SESSION_MINUTES && minutes <= MAX_SESSION_MINUTES) {
      dispatch({ type: "select", minutes });
    } else {
      // Reject an out-of-range entry by restoring the field to the live length.
      setCustomMinutes(String(Math.round(state.durationSeconds / 60)));
    }
  }

  return (
    <div className="session-timer" data-status={state.status}>
      <button
        type="button"
        className="session-timer-toggle"
        onClick={() => dispatch({ type: "toggle", now: Date.now() })}
        aria-label={running ? "Pause writing timer" : active ? "Resume writing timer" : "Start writing timer"}
        title={running ? "Pause timer" : active ? "Resume timer" : "Start a writing session"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2M9 2h6" />
        </svg>
        <span className="session-timer-clock">{formatClock(state.remainingSeconds)}</span>
      </button>
      <div
        className="session-timer-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Writing session progress"
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      {active ? (
        <button
          type="button"
          className="session-timer-reset"
          onClick={() => dispatch({ type: "reset" })}
          aria-label="Reset writing timer"
          title="Reset timer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      ) : (
        <>
          <label className="session-timer-preset">
            <span className="sr-only">Session length</span>
            <select value={choice} onChange={(event) => selectPreset(event.currentTarget.value)}>
              {SESSION_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </select>
          </label>
          {choice === CUSTOM && (
            <input
              className="session-timer-custom"
              type="number"
              min={MIN_SESSION_MINUTES}
              max={MAX_SESSION_MINUTES}
              step={1}
              value={customMinutes}
              aria-label="Custom session length in minutes"
              onChange={(event) => setCustomMinutes(event.currentTarget.value)}
              onBlur={applyCustom}
              onKeyDown={(event) => { if (event.key === "Enter") applyCustom(); }}
            />
          )}
        </>
      )}
    </div>
  );
}