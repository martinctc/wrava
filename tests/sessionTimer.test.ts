import assert from "node:assert/strict";
import test from "node:test";
import {
  createTimer,
  formatClock,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  pauseTimer,
  remainingAt,
  resetTimer,
  sessionProgress,
  startTimer,
  tickTimer,
} from "../src/sessionTimer.ts";

test("a new timer is idle at its full preset length", () => {
  const timer = createTimer(25);
  assert.equal(timer.status, "idle");
  assert.equal(timer.remainingSeconds, 25 * 60);
  assert.equal(timer.durationSeconds, 25 * 60);
  assert.equal(timer.endAt, null);
});

test("custom durations are clamped into range", () => {
  assert.equal(createTimer(0).durationSeconds, MIN_SESSION_MINUTES * 60);
  assert.equal(createTimer(999).durationSeconds, MAX_SESSION_MINUTES * 60);
  assert.equal(createTimer(40).durationSeconds, 40 * 60);
  assert.equal(createTimer(Number.NaN).durationSeconds, 25 * 60);
  assert.equal(createTimer(12.6).durationSeconds, 13 * 60, "whole minutes, rounded");
});

test("a running timer counts down to a fixed end, not a per-tick decrement", () => {
  const start = 1_000_000;
  let timer = startTimer(createTimer(25), start);
  assert.equal(timer.status, "running");
  assert.equal(timer.endAt, start + 25 * 60 * 1000);

  // Halfway through, the remaining time reflects elapsed wall-clock, not ticks.
  timer = tickTimer(timer, start + 12 * 60 * 1000);
  assert.equal(timer.remainingSeconds, 13 * 60);
});

test("a running timer finishes exactly at zero", () => {
  const start = 0;
  let timer = startTimer(createTimer(1), start);
  timer = tickTimer(timer, 60 * 1000 - 1);
  assert.equal(timer.status, "running");
  assert.equal(timer.remainingSeconds, 1);
  timer = tickTimer(timer, 60 * 1000);
  assert.equal(timer.status, "finished");
  assert.equal(timer.remainingSeconds, 0);
  assert.equal(timer.endAt, null);
});

test("pausing freezes the remaining time and resuming continues from it", () => {
  const start = 0;
  let timer = startTimer(createTimer(25), start);
  timer = tickTimer(timer, 5 * 60 * 1000);
  assert.equal(timer.remainingSeconds, 20 * 60);

  timer = pauseTimer(timer, 5 * 60 * 1000 + 30_000);
  assert.equal(timer.status, "paused");
  assert.equal(timer.remainingSeconds, 20 * 60 - 30, "the half minute before pausing counts");
  assert.equal(timer.endAt, null);

  // Resuming re-anchors the end to the frozen remainder, not the original end.
  const resume = 10 * 60 * 1000;
  timer = startTimer(timer, resume);
  assert.equal(timer.status, "running");
  assert.equal(timer.endAt, resume + (20 * 60 - 30) * 1000);
});

test("resetting returns a paused or running timer to a full idle session", () => {
  let timer = startTimer(createTimer(50), 0);
  timer = tickTimer(timer, 10 * 60 * 1000);
  timer = resetTimer(timer);
  assert.equal(timer.status, "idle");
  assert.equal(timer.remainingSeconds, 50 * 60);
  assert.equal(timer.endAt, null);
});

test("starting a finished timer begins a fresh full session", () => {
  let timer = startTimer(createTimer(1), 0);
  timer = tickTimer(timer, 60 * 1000);
  assert.equal(timer.status, "finished");

  timer = startTimer(timer, 120_000);
  assert.equal(timer.status, "running");
  assert.equal(timer.remainingSeconds, 60);
  assert.equal(timer.endAt, 120_000 + 60 * 1000);
});

test("ticking an idle, paused, or finished timer changes nothing", () => {
  const idle = createTimer(25);
  assert.equal(tickTimer(idle, 999_999), idle, "returns the same object, no re-render");
  const paused = pauseTimer(startTimer(createTimer(25), 0), 1000);
  assert.equal(tickTimer(paused, 500_000), paused);
});

test("remainingAt reports the live value for a running timer and the stored one otherwise", () => {
  const timer = startTimer(createTimer(25), 0);
  assert.equal(remainingAt(timer, 10 * 60 * 1000), 15 * 60);
  const idle = createTimer(25);
  assert.equal(remainingAt(idle, 10 * 60 * 1000), 25 * 60);
});

test("progress runs from zero at the start to one at the finish", () => {
  let timer = startTimer(createTimer(25), 0);
  assert.equal(sessionProgress(timer), 0);
  timer = tickTimer(timer, 12.5 * 60 * 1000);
  assert.equal(sessionProgress(timer), 0.5);
  timer = tickTimer(timer, 25 * 60 * 1000);
  assert.equal(sessionProgress(timer), 1);
});

test("the clock formats as MM:SS and rolls over to H:MM:SS past an hour", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(9 * 60 + 5), "09:05");
  assert.equal(formatClock(25 * 60), "25:00");
  assert.equal(formatClock(3600), "1:00:00");
  assert.equal(formatClock(3 * 3600 + 4 * 60 + 5), "3:04:05");
  assert.equal(formatClock(-10), "00:00");
});