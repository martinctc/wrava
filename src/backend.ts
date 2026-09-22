// Platform abstraction: routes storage operations to either the real
// Tauri/Rust core (native desktop app) or the in-browser demo backend
// (GitHub Pages demo), chosen at runtime by whether Wrava is running
// inside a Tauri webview.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AnalyticsView, DocumentResult, DocumentView, WorkspaceView } from "./types";
import {
  DEMO_BANNER,
  DEMO_WORKSPACE_ROOT,
  demoCreateDocument,
  demoOpenWorkspace,
  demoQueryAnalytics,
  demoReadDocument,
  demoRefreshWorkspace,
  demoRenameDocument,
  demoSaveDocument,
} from "./demoBackend";

export { DEMO_BANNER };

export function isDemoMode(): boolean {
  return !("__TAURI_INTERNALS__" in window);
}

export async function setNativeTheme(theme: "light" | "dark"): Promise<void> {
  if (!isDemoMode()) await getCurrentWindow().setTheme(theme);
}

export async function chooseWorkspaceFolder(): Promise<string | null> {
  if (isDemoMode()) {
    return DEMO_WORKSPACE_ROOT;
  }
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function openWorkspace(path: string): Promise<WorkspaceView> {
  if (isDemoMode()) return demoOpenWorkspace();
  return invoke<WorkspaceView>("open_workspace", { path });
}

export async function refreshWorkspace(): Promise<WorkspaceView> {
  if (isDemoMode()) return demoRefreshWorkspace();
  return invoke<WorkspaceView>("refresh_workspace");
}

export async function readDocument(path: string): Promise<DocumentView> {
  if (isDemoMode()) return demoReadDocument(path);
  return invoke<DocumentView>("read_document", { path });
}

export async function saveDocument(
  path: string,
  content: string,
  tags: string[],
): Promise<DocumentResult> {
  if (isDemoMode()) return demoSaveDocument(path, content, tags);
  return invoke<DocumentResult>("save_document", { path, content, tags });
}

export async function createDocument(name: string, title: string): Promise<DocumentResult> {
  if (isDemoMode()) return demoCreateDocument(name, title);
  return invoke<DocumentResult>("create_document", { name, title });
}

export async function renameDocument(path: string, name: string): Promise<DocumentResult> {
  if (isDemoMode()) return demoRenameDocument(path, name);
  return invoke<DocumentResult>("rename_document", { path, name });
}

export async function queryAnalytics(): Promise<AnalyticsView> {
  if (isDemoMode()) return demoQueryAnalytics();
  return invoke<AnalyticsView>("query_analytics");
}
