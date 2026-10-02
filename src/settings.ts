import { emptyGoals, type WritingGoals } from "./writingProgress.ts";

export type Theme = "light" | "dark";
export type SpellingLanguage = "system" | "en-GB" | "en-US" | "off";
export type FilenamePreferences = { includeDate: boolean; maxLength: number };
export type Settings = {
  theme: Theme;
  spelling: SpellingLanguage;
  autosave: boolean;
  editorFontSize: number;
  filename: FilenamePreferences;
  goals: WritingGoals;
  documentOrder: "newest" | "oldest";
};

export const SETTINGS_KEY = "wrava.settings.v1";
export const defaultSettings: Settings = {
  theme: "light",
  spelling: "system",
  autosave: true,
  editorFontSize: 16,
  filename: { includeDate: true, maxLength: 80 },
  goals: emptyGoals,
  documentOrder: "newest",
};

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") throw new Error("Settings must be an object.");
  const data = value as Record<string, unknown>;
  const filename = data.filename;
  const autosave = data.autosave === undefined ? defaultSettings.autosave : data.autosave;
  const editorFontSize = data.editorFontSize === undefined ? defaultSettings.editorFontSize : data.editorFontSize;
  const goals = data.goals === undefined ? emptyGoals : data.goals;
  const documentOrder = data.documentOrder === undefined ? "newest" : data.documentOrder;
  if (typeof autosave !== "boolean") throw new Error("Choose whether to autosave.");
  if (typeof editorFontSize !== "number" || !Number.isInteger(editorFontSize) || editorFontSize < 12 || editorFontSize > 28) {
    throw new Error("Editor font size must be a whole number between 12 and 28.");
  }
  if (data.theme !== "light" && data.theme !== "dark") throw new Error("Choose Light or Dark.");
  if (data.spelling !== "system" && data.spelling !== "en-GB" && data.spelling !== "en-US" && data.spelling !== "off") {
    throw new Error("Choose a supported spellcheck language.");
  }
  if (documentOrder !== "newest" && documentOrder !== "oldest") {
    throw new Error("Choose a document order.");
  }
  if (!goals || typeof goals !== "object" || Array.isArray(goals)) {
    throw new Error("Writing goals are missing.");
  }
  const goalValues = goals as Record<string, unknown>;
  for (const period of ["today", "week", "month", "year"] as const) {
    const goal = goalValues[period];
    if (typeof goal !== "number" || !Number.isSafeInteger(goal) || goal < 0 || goal > 10_000_000) {
      throw new Error(`${period} goal must be a whole number between 0 and 10,000,000.`);
    }
  }
  if (!filename || typeof filename !== "object") throw new Error("Filename settings are missing.");
  const file = filename as Record<string, unknown>;
  if (typeof file.includeDate !== "boolean" || typeof file.maxLength !== "number"
    || !Number.isInteger(file.maxLength) || file.maxLength < 20 || file.maxLength > 120) {
    throw new Error("Filename length must be a whole number between 20 and 120.");
  }
  return {
    theme: data.theme,
    spelling: data.spelling,
    autosave,
    editorFontSize,
    filename: { includeDate: file.includeDate, maxLength: file.maxLength },
    goals: { today: goalValues.today as number, week: goalValues.week as number,
      month: goalValues.month as number, year: goalValues.year as number },
    documentOrder,
  };
}

export function loadSettings(storage: Pick<Storage, "getItem">): { settings: Settings; error?: string } {
  try {
    const saved = storage.getItem(SETTINGS_KEY);
    if (saved !== null) return { settings: validateSettings(JSON.parse(saved)) };
    const legacyTheme = storage.getItem("wrava.theme");
    return { settings: { ...defaultSettings, theme: legacyTheme === "dark" ? "dark" : "light" } };
  } catch (error) {
    return { settings: defaultSettings, error: `Could not load settings. Using defaults: ${String(error)}` };
  }
}

export function loadLocalSettings() {
  try {
    return loadSettings(localStorage);
  } catch (error) {
    return { settings: defaultSettings, error: `Could not access settings storage: ${String(error)}` };
  }
}
