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