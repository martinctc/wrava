// Remembers the last opened writing folder so Wrava can reopen it on
// startup. Only the absolute root path is stored, never document contents
// or activity data. Mirrors the localStorage pattern used by settings.ts,
// but kept separate because this is session state, not a user preference.
export const WORKSPACE_KEY = "wrava.workspace.v1";

export function saveWorkspacePath(storage: Pick<Storage, "setItem">, path: string): void {
  storage.setItem(WORKSPACE_KEY, path);
}

export function loadWorkspacePath(storage: Pick<Storage, "getItem">): string | null {
  const saved = storage.getItem(WORKSPACE_KEY);
  return saved && saved.trim() ? saved : null;
}

export function forgetWorkspacePath(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(WORKSPACE_KEY);
}

// True only when the backend reported that the folder itself is gone. Every
// other failure — an offline network drive, a sync tool holding a lock, a
// database error — is treated as transient, so the remembered path is kept
// and retried on the next launch instead of being silently thrown away.
export function isMissingFolderError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("cannot find") ||
    message.includes("no such file") ||
    message.includes("not a folder") ||
    message.includes("not a directory")
  );
}