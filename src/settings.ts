export type Theme = "light" | "dark";
export type SpellingLanguage = "system" | "en-GB" | "en-US" | "off";
export type FilenamePreferences = { includeDate: boolean; maxLength: number };
export type Settings = {
  theme: Theme;
  spelling: SpellingLanguage;
  autosave: boolean;
  editorFontSize: number;
  filename: FilenamePreferences;
};

export const SETTINGS_KEY = "wrava.settings.v1";
export const defaultSettings: Settings = {
  theme: "light",
  spelling: "system",
  autosave: true,
  editorFontSize: 16,
  filename: { includeDate: true, maxLength: 80 },
};

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") throw new Error("Settings must be an object.");
  const data = value as Record<string, unknown>;
  const filename = data.filename;
  const autosave = data.autosave === undefined ? defaultSettings.autosave : data.autosave;
  const editorFontSize = data.editorFontSize === undefined ? defaultSettings.editorFontSize : data.editorFontSize;
  if (typeof autosave !== "boolean") throw new Error("Choose whether to autosave.");
  if (typeof editorFontSize !== "number" || !Number.isInteger(editorFontSize) || editorFontSize < 12 || editorFontSize > 28) {
    throw new Error("Editor font size must be a whole number between 12 and 28.");
  }
  if (data.theme !== "light" && data.theme !== "dark") throw new Error("Choose Light or Dark.");
  if (data.spelling !== "system" && data.spelling !== "en-GB" && data.spelling !== "en-US" && data.spelling !== "off") {
    throw new Error("Choose a supported spellcheck language.");
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
