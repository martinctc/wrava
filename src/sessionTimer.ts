export const SESSION_PRESETS = [
  { label: "25 min (Pomodoro)", value: 25 },
  { label: "50 min (Deep work)", value: 50 },
] as const;

export type WritingSession = {
  presetMinutes: number;
  startTime?: Date;
  running: boolean;
};
