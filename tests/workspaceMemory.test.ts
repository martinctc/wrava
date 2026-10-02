import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_KEY,
  forgetWorkspacePath,
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