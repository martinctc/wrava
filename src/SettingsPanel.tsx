import { useEffect, useRef, useState } from "react";
import { suggestedFilename } from "./documentIdentity";
import { validateSettings, type Settings } from "./settings";

export function SettingsPanel({ settings, onSave, onClose }: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [length, setLength] = useState(String(settings.filename.maxLength));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function close() {
    dialog.current?.close();
    onClose();
  }
  const limit = Number(length);
  const preview = suggestedFilename("Reflections on Discipline", new Date(), {
    includeDate: draft.filename.includeDate,
    maxLength: Number.isInteger(limit) && limit >= 20 && limit <= 120 ? limit : settings.filename.maxLength,
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSave(validateSettings({ ...draft, filename: { ...draft.filename, maxLength: limit } }));
      close();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="settings-panel" aria-labelledby="settings-heading"
      onCancel={(event) => { event.preventDefault(); if (!saving) close(); }}
      onKeyDown={(event) => event.stopPropagation()}>
      <form onSubmit={submit}>
        <header className="settings-header">
          <h2 id="settings-heading">Settings</h2>
          <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Close settings" title="Close settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <fieldset disabled={saving}>
          <legend>Appearance</legend>
          <label htmlFor="setting-theme">Colour theme</label>
          <select id="setting-theme" value={draft.theme} onChange={(event) =>
            setDraft(validateSettings({ ...draft, theme: event.currentTarget.value }))}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </fieldset>
        <fieldset disabled={saving}>
          <legend>Writing</legend>
          <label className="settings-checkbox">
            <input type="checkbox" checked={draft.autosave} onChange={(event) =>
              setDraft({ ...draft, autosave: event.currentTarget.checked })} />
            Autosave
          </label>
          <p>Save writing and tags after two seconds without editing. You can still save immediately with Ctrl+S.</p>
          <label htmlFor="setting-font-size">Editor text size: {draft.editorFontSize} px</label>
          <input id="setting-font-size" type="range" min={12} max={28} step={1}
            value={draft.editorFontSize} aria-valuetext={`${draft.editorFontSize} pixels`}
            onChange={(event) => setDraft({ ...draft, editorFontSize: Number(event.currentTarget.value) })} />
          <div className="font-size-preview" style={{ fontSize: `${draft.editorFontSize}px` }}>A little space for your next idea.</div>
          <p>Applies to both editors. The rest of the interface stays the same size.</p>
        </fieldset>
        <fieldset disabled={saving}>
          <legend>Spellcheck</legend>
          <label htmlFor="setting-spelling">Spelling language</label>
          <select id="setting-spelling" value={draft.spelling} onChange={(event) =>
            setDraft(validateSettings({ ...draft, spelling: event.currentTarget.value }))}>
            <option value="system">System default</option>
            <option value="en-GB">English (United Kingdom)</option>
            <option value="en-US">English (United States)</option>
            <option value="off">Off</option>
          </select>
          {draft.spelling === "system" ? <p>Uses your Windows or browser spelling settings.</p>
            : draft.spelling === "off" ? <p>Spelling checks are disabled in both editors.</p>
              : <>
                <p>{draft.spelling === "en-GB" ? "British English (-ise spellings)" : "US English"}, checked offline in both editors.</p>
                <p>Right-click an underlined word or press Alt+Enter for suggestions. Corrections are only applied when you choose one.</p>
              </>}
        </fieldset>
        <fieldset disabled={saving}>
          <legend>New filenames</legend>
          <label className="settings-checkbox">
            <input type="checkbox" checked={draft.filename.includeDate} onChange={(event) =>
              setDraft({ ...draft, filename: { ...draft.filename, includeDate: event.currentTarget.checked } })} />
            Include the date (yyyy-mm-dd)
          </label>
          <label htmlFor="setting-filename-length">Maximum generated filename length</label>
          <input id="setting-filename-length" type="number" required min={20} max={120} step={1}
            value={length} onChange={(event) => setLength(event.currentTarget.value)} />
          <p>20–120 characters, including the date and .md. These preferences affect suggestions for new files only. Existing files and custom names stay unchanged.</p>
          <output className="filename-preview" aria-label="Example filename">{preview}</output>
        </fieldset>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <footer className="settings-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
        </footer>
      </form>
    </dialog>
  );
}
