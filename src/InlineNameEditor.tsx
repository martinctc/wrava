import { useRef, useState } from "react";

export function InlineNameEditor({ value, display, label, extension = "", heading = false, busy, onRename }: {
  value: string;
  display: string;
  label: string;
  extension?: string;
  heading?: boolean;
  busy: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(value);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);

  function cancel() {
    setEditing(false);
    setName(value);
    setError("");
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting.current || !name.trim()) return;
    if ((extension ? name.trim().replace(/\.md$/i, "") : name.trim()) === value) {
      cancel();
      return;
    }
    submitting.current = true;
    setError("");
    try {
      await onRename(name.trim());
      cancel();
    } catch (error) {
      setError(String(error));
    } finally {
      submitting.current = false;
    }
  }

  const button = (
    <button ref={titleRef} className="document-title" disabled={busy} onClick={() => {
      setName(value);
      setEditing(true);
    }} title={`${display} (click to edit ${label.toLowerCase()})`} aria-label={`Edit ${label.toLowerCase()}: ${display}`}>
      {display}
    </button>
  );

  return editing ? (
    <form className="inline-rename" onSubmit={submit} onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) cancel();
      }
    }}>
      <div className="rename-controls">
        <input
          aria-label={label}
          spellCheck={extension ? false : undefined}
          aria-describedby={error ? `${extension ? "file" : "title"}-rename-error` : undefined}
          aria-invalid={Boolean(error)}
          autoFocus
          required
          disabled={busy}
          value={name}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {extension && <span className="rename-extension">{extension}</span>}
        <button className="icon-button" type="submit" aria-label={`Apply ${label.toLowerCase()}`} title={`Apply ${label.toLowerCase()}`} disabled={busy || !name.trim()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </button>
        <button className="icon-button" type="button" onClick={cancel} aria-label="Cancel rename" title="Cancel rename" disabled={busy}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </div>
      <p className="rename-hint">Enter to apply. Escape to cancel.</p>
      {error && <p id={`${extension ? "file" : "title"}-rename-error`} className="rename-error" role="alert">{error}</p>}
    </form>
  ) : heading ? <h1>{button}</h1> : button;
}