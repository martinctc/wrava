import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLDER_MISSING_CODE,
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
  // The code is what decides this, not the wording. Each of these messages used
  // to be matched by substring, which broke on a localised operating system.
  assert.equal(isMissingFolderError({ code: FOLDER_MISSING_CODE, message: "The system cannot find the path specified." }), true);
  assert.equal(isMissingFolderError({ code: FOLDER_MISSING_CODE, message: "Der Pfad wurde nicht gefunden." }), true);
  assert.equal(isMissingFolderError({ code: FOLDER_MISSING_CODE, message: "The selected workspace is not a folder." }), true);
});

test("keeps the remembered folder for failures that may be temporary", () => {
  assert.equal(isMissingFolderError({ code: "workspace_open_failed", message: "Access is denied. (os error 5)" }), false);
  assert.equal(isMissingFolderError({ code: "workspace_open_failed", message: "The process cannot access the file because it is being used by another process. (os error 32)" }), false);
  assert.equal(isMissingFolderError({ code: "workspace_open_failed", message: "Database is locked" }), false);
  assert.equal(isMissingFolderError(new Error("network is unreachable")), false);
  assert.equal(isMissingFolderError(undefined), false);
});

test("a message that merely reads like a missing folder is not enough", () => {
  // The regression this replaces: any error whose text happened to contain
  // "not a directory" silently threw away the remembered folder.
  assert.equal(isMissingFolderError("The process cannot access the file because it is being used by another process."), false);
  assert.equal(isMissingFolderError("Drive D:\\ is not a directory mount"), false);
  assert.equal(isMissingFolderError({ message: "The system cannot find the path specified." }), false);
});