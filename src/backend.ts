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
  demoSearchDocumentContent,
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

/**
 * An error the backend reported, carrying the machine-readable `code` the Rust
 * core attaches to it.
 *
 * Tauri rejects with the serialised error value rather than an `Error`, and
 * `String()` on that object would render `[object Object]` in the status line.
 * `toString` is overridden so the text a writer reads is the message alone,
 * exactly as it was before errors carried a code.
 */
export class BackendError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "BackendError";
  }

  override toString(): string {
    return this.message;
  }
}

type CodedError = { code?: unknown; message?: unknown };

/** Re-raises whatever the backend rejected as a `BackendError` that keeps its code. */
function asBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as CodedError;
    if (typeof message === "string") {
      return new BackendError(message, typeof code === "string" ? code : undefined);
    }
  }
  return new BackendError(String(error));
}

export async function openWorkspace(path: string): Promise<WorkspaceView> {
  if (isDemoMode()) return demoOpenWorkspace();
  try {
    return await invoke<WorkspaceView>("open_workspace", { path });
  } catch (error) {
    throw asBackendError(error);
  }
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

/**
 * The documents whose text contains `query`, as the same relative paths
 * `WorkspaceView.files` carries. An empty list means "nothing extra to add",
 * which is also what a query too short to be worth a walk returns.
 */
export async function searchDocumentContent(query: string): Promise<string[]> {
  if (isDemoMode()) return demoSearchDocumentContent(query);
  return invoke<string[]>("search_document_content", { query });
}
