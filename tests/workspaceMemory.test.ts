import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_KEY,
  forgetWorkspacePath,
  isMissingFolderError,
  loadWorkspacePath,
  saveWorkspacePath,
} from "../src/workspaceMemory.ts";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

test("remembers the last writing folder and forgets it on request", () => {
  const storage = memoryStorage();
  assert.equal(loadWorkspacePath(storage), null);

  saveWorkspacePath(storage, "C:/Users/kai/Writing");
  assert.equal(storage.getItem(WORKSPACE_KEY), "C:/Users/kai/Writing");
  assert.equal(loadWorkspacePath(storage), "C:/Users/kai/Writing");

  saveWorkspacePath(storage, "D:/Notes");
  assert.equal(loadWorkspacePath(storage), "D:/Notes", "the newest folder wins");

  forgetWorkspacePath(storage);
  assert.equal(loadWorkspacePath(storage), null);
});

test("ignores blank remembered paths", () => {
  const storage = memoryStorage();
  storage.setItem(WORKSPACE_KEY, "   ");
  assert.equal(loadWorkspacePath(storage), null);

  storage.setItem(WORKSPACE_KEY, "");
  assert.equal(loadWorkspacePath(storage), null);
});

test("treats a genuinely missing folder as forgettable", () => {
  assert.equal(isMissingFolderError("The system cannot find the file specified. (os error 2)"), true);
  assert.equal(isMissingFolderError("The system cannot find the path specified."), true);
  assert.equal(isMissingFolderError("No such file or directory (os error 2)"), true);
  assert.equal(isMissingFolderError("The selected workspace is not a folder."), true);
  assert.equal(isMissingFolderError("Not a directory (os error 20)"), true);
});

test("keeps the remembered folder for failures that may be temporary", () => {
  assert.equal(isMissingFolderError("Access is denied. (os error 5)"), false);
  assert.equal(isMissingFolderError("The process cannot access the file because it is being used by another process. (os error 32)"), false);
  assert.equal(isMissingFolderError("Database is locked"), false);
  assert.equal(isMissingFolderError("Error: something went wrong"), false);
  assert.equal(isMissingFolderError(new Error("network is unreachable")), false);
  assert.equal(isMissingFolderError(undefined), false);
});