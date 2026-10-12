export function WelcomePanel({ restoring, restoreFailed, busy, onChooseWorkspace, onForgetWorkspace }: {
  restoring: string | null;
  restoreFailed: boolean;
  busy: boolean;
  onChooseWorkspace: () => void;
  onForgetWorkspace: () => void;
}) {
  return (
    <div className="welcome-panel">
      <div className="welcome-mark">W</div>
      {restoring ? (
        <>
          <p className="eyebrow">Reopening your folder</p>
          <h1>One moment…</h1>
          <p title={restoring}>
            Wrava is reopening <strong>{restoring}</strong> and re-reading
            your Markdown files.
          </p>
        </>
      ) : (
        <>
          <p className="eyebrow">Your words, your files</p>
          <h1>Make your writing visible.</h1>
          <p>
            Choose a folder of Markdown files. Wrava will establish a baseline,
            then track additions and document growth from every accepted change.
          </p>
          <button className="primary-button" onClick={onChooseWorkspace} disabled={busy}>
            Choose writing folder
          </button>
          {restoreFailed && (
            <div>
              <button
                type="button"
                className="text-button restore-fallback"
                onClick={onForgetWorkspace}
                disabled={busy}
              >
                Stop reopening the last folder
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}