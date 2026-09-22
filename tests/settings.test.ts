import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, loadSettings, SETTINGS_KEY, validateSettings } from "../src/settings.ts";
import { suggestedFilename, documentFilename } from "../src/documentIdentity.ts";

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });

test("defaults to system spelling and migrates an existing theme preference", () => {
  assert.deepEqual(loadSettings(storage({})).settings, defaultSettings);
  assert.equal(loadSettings(storage({ "wrava.theme": "dark" })).settings.theme, "dark");
  assert.equal(loadSettings(storage({})).settings.spelling, "system");
});

test("round-trips settings without letting legacy theme override them", () => {
  const settings = { ...defaultSettings, theme: "light", spelling: "en-GB", autosave: false, editorFontSize: 24, filename: { includeDate: false, maxLength: 40 } };
  assert.deepEqual(loadSettings(storage({ [SETTINGS_KEY]: JSON.stringify(settings), "wrava.theme": "dark" })).settings, settings);
});

test("older settings gain autosave and editor size without losing preferences", () => {
  const legacy = { theme: "dark", spelling: "en-GB", filename: { includeDate: false, maxLength: 40 } };
  assert.deepEqual(loadSettings(storage({ [SETTINGS_KEY]: JSON.stringify(legacy) })).settings,
    { ...legacy, autosave: true, editorFontSize: 16 });
  for (const editorFontSize of [11, 29, 16.5, "16", null]) {
    assert.throws(() => validateSettings({ ...defaultSettings, editorFontSize }));
  }
  for (const autosave of ["true", 1, null]) {
    assert.throws(() => validateSettings({ ...defaultSettings, autosave }));
  }
});

test("invalid or inaccessible settings report errors explicitly", () => {
  for (const spelling of ["fr", ["en-GB"], null]) {
    assert.throws(() => validateSettings({ ...defaultSettings, spelling }));
  }
  for (const maxLength of [19, 121, 30.5, "80", NaN]) {
    assert.throws(() => validateSettings({ ...defaultSettings, filename: { includeDate: true, maxLength } }));
  }
  assert.match(loadSettings(storage({ [SETTINGS_KEY]: "not json" })).error ?? "", /Could not load/);
  assert.match(loadSettings({ getItem() { throw new Error("blocked"); } }).error ?? "", /blocked/);
});

test("filename preferences affect suggestions, with and without the date", () => {
  const date = new Date(2026, 8, 18);
  assert.equal(suggestedFilename("Reflections on Discipline", date, { includeDate: false, maxLength: 80 }), "reflections-on-discipline.md");
  for (const includeDate of [true, false]) {
    for (const maxLength of [20, 40, 80, 120]) {
      const name = suggestedFilename("A very long title ".repeat(20), date, { includeDate, maxLength });
      assert.ok(name.length <= maxLength);
      assert.equal(documentFilename(name), name);
      assert.equal(name.startsWith("2026-09-18_"), includeDate);
    }
  }
  assert.equal(suggestedFilename("CON", date, { includeDate: false, maxLength: 80 }), "note-con.md");
});
