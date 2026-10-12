import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { closeHistory } from "@milkdown/kit/prose/history";
import { joinMarkdownBody, suggestedFilename, splitMarkdownDocument, writingTitle, withWritingTitle } from "./documentIdentity";
import { loadLocalSettings, SETTINGS_KEY, type Settings } from "./settings";
import { forgetWorkspacePath, isMissingFolderError, loadWorkspacePath, saveWorkspacePath } from "./workspaceMemory";
import { sortDocuments, weekPace } from "./writingProgress";
import { ActivityStrip } from "./ActivityStrip";
import { AnalyticsPage } from "./AnalyticsPage";
import { InlineNameEditor } from "./InlineNameEditor";
import { RichMarkdownEditor } from "./RichMarkdownEditor";
import { SettingsPanel } from "./SettingsPanel";
import { SpellingMenu } from "./SpellingMenu";
import { WelcomePanel } from "./WelcomePanel";
import { loadDictionary } from "./spellingDictionaries";
import type { SpellingChecker } from "./spellcheckCore";
import { sourceSpelling, type SpellingOptions, type SpellingRequest } from "./spellingEditors";
import {
  DEMO_BANNER,
  chooseWorkspaceFolder,
  createDocument as backendCreateDocument,
  isDemoMode,
  openWorkspace,
  queryAnalytics,
  readDocument,
  refreshWorkspace as backendRefreshWorkspace,
  renameDocument as backendRenameDocument,
  saveDocument as backendSaveDocument,
  setNativeTheme,
} from "./backend";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./App.css";
import "./theme.css";
import "./settings.css";
import {
  AnalyticsView,
  DocumentResult,
  DocumentView,
  WorkspaceView,
  emptyStats,
} from "./types";

function App() {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const richEditorRef = useRef<Crepe | null>(null);
  const [loadedSettings] = useState(loadLocalSettings);
  const [settings, setSettings] = useState(loadedSettings.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dictionary, setDictionary] = useState<{ language: string; checker: SpellingChecker | null }>({ language: "", checker: null });
  const [spellingRequest, setSpellingRequest] = useState<SpellingRequest | null>(null);
  const theme = settings.theme;
  const spelling = useMemo<SpellingOptions>(() => ({
    language: settings.spelling,
    checker: dictionary.language === settings.spelling ? dictionary.checker : null,
  }), [settings.spelling, dictionary]);
  const sourceExtensions = useMemo(() => [
    markdown(), EditorView.lineWrapping, sourceSpelling(spelling, setSpellingRequest),
  ], [spelling]);
  const [page, setPage] = useState<"write" | "analytics">("write");
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [document, setDocument] = useState<DocumentView | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsView | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentOrder, setDocumentOrder] = useState<Settings["documentOrder"] | null>(null);
  const [editorMode, setEditorMode] = useState<"rich" | "source">("rich");
  const [focusMode, setFocusMode] = useState(false);
  const [richEditorVersion, setRichEditorVersion] = useState(0);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [documentNameSuggested, setDocumentNameSuggested] = useState(false);
  const [documentModalError, setDocumentModalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  // Set when the remembered folder failed to open but was kept because the
  // failure looked temporary, so the welcome panel can offer a way out.
  const [restoreFailed, setRestoreFailed] = useState(false);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState("");
  const draftRef = useRef({ document, content, tagInput, editorMode });
  draftRef.current = { document, content, tagInput, editorMode };
  const [status, setStatus] = useState(loadedSettings.error ?? "Choose a folder to begin tracking your writing.");
  const title = useMemo(() => writingTitle(content), [content]);

  useLayoutEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    void setNativeTheme(theme).catch((error) => {
      setStatus(`Could not update the window theme: ${String(error)}`);
    });
  }, [theme]);

  useLayoutEffect(() => {
    window.document.documentElement.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  }, [settings.editorFontSize]);

  useEffect(() => {
    let active = true;
    const language = settings.spelling;
    setSpellingRequest(null);
    if (language === "en-GB" || language === "en-US") {
      void loadDictionary(language).then(checker => {
        if (active) setDictionary({ language, checker });
      }).catch(error => {
        if (active) setStatus(`Spellcheck unavailable: ${String(error)}. Reopen Settings to retry.`);
      });
    } else {
      setDictionary({ language, checker: null });
    }
    return () => { active = false; };
  }, [settings.spelling]);

  async function saveSettings(next: Settings) {
    if (next.spelling === "en-GB" || next.spelling === "en-US") {
      const checker = await loadDictionary(next.spelling);
      setDictionary({ language: next.spelling, checker });
    }

    persistSettings(next);
    setDocumentOrder(null);
  }

  function persistSettings(next: Settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
    setStatus("Settings saved on this device.");
  }

  function toggleTheme() {
    try {
      persistSettings({ ...settings, theme: theme === "light" ? "dark" : "light" });
    } catch (error) {
      setStatus(`Could not save the theme preference: ${String(error)}`);
    }
  }

  function newFilename(title: string) {
    return suggestedFilename(title, new Date(), settings.filename).replace(/\.md$/, "");
  }

  function currentContent() {
    if (editorMode !== "rich" || !richEditorRef.current) return content;
    return joinMarkdownBody(content, richEditorRef.current.getMarkdown());
  }

  async function changeWritingTitle(nextTitle: string) {
    if (editorMode === "rich") {
      if (!richEditorRef.current) throw new Error("The editor is still loading. Try again.");
      richEditorRef.current.editor.action(ctx => {
        const view = ctx.get(editorViewCtx);
        const heading = ctx.get(parserCtx)(withWritingTitle("", nextTitle))?.firstChild;
        if (!heading) throw new Error("Could not create the writing title.");
        let position: number | null = null;
        view.state.doc.forEach((node, offset) => {
          if (position === null && node.type === heading.type && node.attrs.level === 1) position = offset;
        });
        const transaction = view.state.tr;
        if (position === null) {
          transaction.insert(0, heading);
        } else {
          const existing = view.state.doc.nodeAt(position);
          if (!existing) throw new Error("Could not locate the writing title.");
          transaction.replaceWith(position + 1, position + existing.nodeSize - 1, heading.content);
        }
        view.dispatch(closeHistory(transaction));
        view.dispatch(closeHistory(view.state.tr));
      });
    } else {
      const view = editorRef.current?.view;
      if (!view) throw new Error("The editor is still loading. Try again.");
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: withWritingTitle(view.state.doc.toString(), nextTitle) },
        annotations: isolateHistory.of("full"),
      });
    }
    setStatus(settings.autosave ? "Title updated. Autosave pending; the file name is unchanged."
      : "Title updated. Save to write it to the document; the file name is unchanged.");
  }

  const run = useCallback(async <T,>(operation: () => Promise<T>) => {
    setBusy(true);
    try {
      return await operation();
    } catch (error) {
      setStatus(String(error));
      throw error;
    } finally {
      setBusy(false);
    }

  }, []);

  async function chooseWorkspace() {
    if ((contentChanged || tagsChanged) && !window.confirm("Discard your unsaved changes and change folder?")) {
      return;
    }
    const selected = await chooseWorkspaceFolder();
    if (!selected) return;
    await openRememberedWorkspace(selected);
  }

  // Opens a folder and, outside the browser demo, remembers it for next launch.
  // The path is only stored once the backend confirms the folder opened.
  async function openRememberedWorkspace(path: string) {
    setRestoring(path);
    try {
      const next = await run(() => openWorkspace(path));
      let rememberFailure = "";
      if (!isDemoMode()) {
        try {
          saveWorkspacePath(localStorage, path);
        } catch (error) {
          rememberFailure = ` Could not remember this folder for next time: ${String(error)}`;
        }
      }
      setWorkspace(next);
      setRestoreFailed(false);
      setDocument(null);
      setAnalytics(null);
      setContent("");
      setSavedContent("");
      setTagInput("");
      setDocumentSearch("");
      setFocusMode(false);
      setPage("write");
      setStatus(
        (next.files.length
          ? `Tracking ${next.files.length} Markdown file${next.files.length === 1 ? "" : "s"}.`
          : "Workspace ready. Create your first Markdown file.") + rememberFailure,
      );
    } finally {
      setRestoring(null);
    }
  }

  function forgetWorkspace() {
    try {
      forgetWorkspacePath(localStorage);
    } catch (error) {
      setStatus(`Could not forget this folder: ${String(error)}`);
      return;
    }
    setWorkspace(null);
    setDocument(null);
    setAnalytics(null);
    setContent("");
    setSavedContent("");
    setTagInput("");
    setDocumentSearch("");
    setFocusMode(false);
    setRestoreFailed(false);
    setPage("write");
    setStatus("Forgot this folder. Choose a folder to begin tracking your writing.");
  }

  // Reopen the last folder on startup. Guarded so it cannot race autosave or the
  // unsaved-changes warning, and skipped entirely in the browser demo, which
  // does not persist anything between visits.
  useEffect(() => {
    if (isDemoMode() || workspace || document) return;
    let remembered: string | null = null;
    try {
      remembered = loadWorkspacePath(localStorage);
    } catch {
      return;
    }
    if (!remembered) return;
    let active = true;
    void (async () => {
      setRestoring(remembered!);
      try {
        const next = await run(() => openWorkspace(remembered!));
        if (!active) return;
        setWorkspace(next);
        setStatus(`Reopened ${next.root}.`);
      } catch (error) {
        if (!active) return;
        if (isMissingFolderError(error)) {
          // The folder itself is gone. Forget it so the next launch does not
          // retry, and fall back to the folder prompt.
          try {
            forgetWorkspacePath(localStorage);
          } catch {
            // Storage is unavailable; the prompt still works.
          }
          setStatus("Your last folder is no longer available. Choose a folder to continue.");
        } else {
          // Anything else may be temporary — an offline network drive, a sync
          // tool holding a lock, a database conflict. Keep the path so the next
          // launch retries, and offer an explicit way out instead.
          setRestoreFailed(true);
          setStatus("Could not reopen your last folder right now. It will be tried again on the next launch.");
        }
      } finally {
        if (active) setRestoring(null);
      }
    })();
    return () => { active = false; };
  }, []);

  async function selectDocument(path: string) {
    if ((contentChanged || tagsChanged) && !window.confirm("Discard your unsaved changes?")) {
      return;
    }
    const next = await run(() => readDocument(path));
    setDocument(next);
    setContent(next.content);
    setSavedContent(next.content);
    setTagInput(next.tags.join(", "));
    setRichEditorVersion((version) => version + 1);
    setStatus(`${next.wordCount.toLocaleString()} words`);
  }

  async function saveDocument(automatic = false) {
    if (!document || busy || saving.current) return;
    const submitted = currentContent();
    if (submitted === savedContent && !tagsChanged) return;
    const submittedTags = tagInput;
    const path = document.path;
    saving.current = true;
    setSaveError("");
    try {
      const saved = await run(() => backendSaveDocument(path, submitted, parsedTags));
      const latest = draftRef.current;
      if (latest.document?.path !== path) return;
      const latestContent = latest.editorMode === "rich" && richEditorRef.current
        ? joinMarkdownBody(latest.content, richEditorRef.current.getMarkdown())
        : latest.content;
      // A save acknowledges its snapshot, never edits typed while it was running.
      const unchanged = latestContent === submitted && latest.tagInput === submittedTags;
      setWorkspace(saved.workspace);
      setDocument(saved.document);
      setAnalytics(null);
      setSavedContent(unchanged ? saved.document.content : submitted);
      if (unchanged) setContent(saved.document.content);
      setStatus(automatic ? "Autosaved and activity updated." : "Saved and activity updated.");
    } catch (error) {
      setSaveError(`${automatic ? "Autosave" : "Save"} failed: ${String(error)}. Your changes are still in the editor. Press Save to retry.`);
    } finally {
      saving.current = false;
    }
  }

  async function createDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDocumentModalError("");
    try {
      const created = await run(() => backendCreateDocument(documentName, newTitle));
      applyDocumentResult(created);
      setCreatingDocument(false);
      setPage("write");
      setStatus(`Created ${created.document.path}.`);
    } catch (error) {
      setDocumentModalError(String(error));
    }
  }

  async function renameDocument(name: string) {
    if (!document || busy) return;
    const renamed = await run(() => backendRenameDocument(document.path, name));
    setWorkspace(renamed.workspace);
    setDocument(renamed.document);
    setAnalytics(null);
    // Renaming only changes the path. Keep unsaved editor text and tags intact.
    setStatus(`Renamed to ${renamed.document.path}.`);
  }

  function applyDocumentResult(result: DocumentResult, preserveEditorMode = false) {
    setWorkspace(result.workspace);
    setDocument(result.document);
    setContent(result.document.content);
    setSavedContent(result.document.content);
    setTagInput(result.document.tags.join(", "));
    setDocumentName("");
    setNewTitle("");
    setDocumentModalError("");
    setAnalytics(null);
    if (!preserveEditorMode) {
      setEditorMode("rich");
    }
    setRichEditorVersion((version) => version + 1);
  }

  async function refreshWorkspace() {
    if (!workspace) return;
    const next = await run(() => backendRefreshWorkspace());
    setWorkspace(next);
    setAnalytics(null);
    if (
      document
      && !contentChanged
      && !tagsChanged
      && next.files.includes(document.path)
    ) {
      const refreshed = await readDocument(document.path);
      setDocument(refreshed);
      setContent(refreshed.content);
      setSavedContent(refreshed.content);
      setTagInput(refreshed.tags.join(", "));
      setRichEditorVersion((version) => version + 1);
    }
    setStatus("Workspace refreshed.");
  }

  async function showAnalytics() {
    if (!workspace) return;
    if ((contentChanged || tagsChanged) && !window.confirm("Open analytics without saving your changes?")) {
      return;
    }
    const next = await run(() => queryAnalytics());
    setAnalytics(next);
    setFocusMode(false);
    setPage("analytics");
    setStatus("Showing the last 12 weeks of writing activity.");
  }

  function closeDocumentModal() {
    setCreatingDocument(false);
    setDocumentName("");
    setNewTitle("");
    setDocumentNameSuggested(false);
    setDocumentModalError("");
  }

  function wrapSelection(before: string, after = before, placeholder = "text") {
    const view = editorRef.current?.view;
    if (!view) return;
    const selection = view.state.selection.main;
    const selected = view.state.sliceDoc(selection.from, selection.to) || placeholder;
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: `${before}${selected}${after}`,
      },
      selection: {
        anchor: selection.from + before.length,
        head: selection.from + before.length + selected.length,
      },
    });
    view.focus();
  }

  function updateRichContent(markdownBody: string) {
    setContent((current) => joinMarkdownBody(current, markdownBody));
  }

  function changeEditorMode(mode: "rich" | "source") {
    if (editorMode === "rich") setContent(currentContent());
    if (mode === "rich") {
      setRichEditorVersion((version) => version + 1);
    }
    setEditorMode(mode);
  }

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.defaultPrevented || settingsOpen || spellingRequest) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!busy) void saveDocument();
      }
      if (event.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  const stats = workspace?.stats ?? emptyStats;
  const orderedFiles = useMemo(
    () => sortDocuments(workspace?.files ?? [], documentOrder ?? settings.documentOrder),
    [workspace?.files, documentOrder, settings.documentOrder],
  );

  const weeklyPace = weekPace(stats, new Date());
  const parsedTags = tagInput
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const normalizedTagInput = [...new Set(parsedTags.map((tag) => tag.toLowerCase()))].sort();
  const normalizedSavedTags = document
    ? [...new Set(document.tags.map((tag) => tag.toLowerCase()))].sort()
    : [];
  const contentChanged = content !== savedContent;
  const tagsChanged =
    normalizedTagInput.length !== normalizedSavedTags.length
    || normalizedTagInput.some((tag, index) => tag !== normalizedSavedTags[index]);

  const saveRef = useRef(saveDocument);
  saveRef.current = saveDocument;
  useEffect(() => { setSaveError(""); }, [document?.path, settings.autosave]);
  useEffect(() => {
    if (!settings.autosave || !document || busy || saveError || settingsOpen || spellingRequest
      || creatingDocument || page !== "write" || (!contentChanged && !tagsChanged)) return;
    const timer = window.setTimeout(() => { void saveRef.current(true); }, 2000);
    return () => window.clearTimeout(timer);
  }, [settings.autosave, document?.path, content, tagInput, contentChanged, tagsChanged,
    busy, saveError, settingsOpen, spellingRequest, creatingDocument, page]);

  useEffect(() => {
    if (!contentChanged && !tagsChanged) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [contentChanged, tagsChanged]);

  const shellClasses = [
    "app-shell",
    focusMode ? "focus-mode" : "",
    page === "analytics" || focusMode ? "compact-activity" : "",
    isDemoMode() && !focusMode ? "has-demo-banner" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClasses} spellCheck={settings.spelling === "system"}>
      {isDemoMode() && !focusMode && (
        <div className="demo-banner" role="status">
          {DEMO_BANNER}
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <div>
            <strong>Wrava</strong>
            <span>Build a writing practice</span>
          </div>
        </div>
        {workspace && (
          <nav className="page-tabs" aria-label="Main pages">
            <button
              className={page === "write" ? "active" : ""}
              onClick={() => setPage("write")}
              disabled={busy}
              aria-current={page === "write" ? "page" : undefined}
            >
              Write
            </button>
            <button
              className={page === "analytics" ? "active" : ""}
              onClick={showAnalytics}
              disabled={busy}
              aria-current={page === "analytics" ? "page" : undefined}
            >
              Analytics
            </button>
          </nav>
        )}
        <div className="topbar-actions">
          <button className="icon-button theme-toggle" onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              {theme === "light" ? <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />
                : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
            </svg>
          </button>
          <button className="icon-button settings-toggle" onClick={() => setSettingsOpen(true)}
            aria-label="Settings" title="Settings" aria-haspopup="dialog">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z" transform="translate(1 1) scale(.9)" />
            </svg>
          </button>
          {workspace && (
            <>
              <button
                className="secondary-button"
                onClick={() => {
                  if ((contentChanged || tagsChanged) && !window.confirm("Discard your unsaved changes and create a new document?")) {
                    return;
                  }
                  setNewTitle("");
                  setDocumentName(newFilename(""));
                  setDocumentNameSuggested(true);
                  setDocumentModalError("");
                  setCreatingDocument(true);
                }}
                disabled={busy}
              >
                New file
              </button>
              <button className="secondary-button" onClick={refreshWorkspace} disabled={busy}>
                Refresh
              </button>
            </>
          )}
          <button className="primary-button" onClick={chooseWorkspace} disabled={busy}>
            {workspace ? "Change folder" : "Choose writing folder"}
          </button>
        </div>
      </header>

      <ActivityStrip stats={stats} settings={settings} pace={weeklyPace}
        compact={page !== "write" || focusMode} />

      {page === "analytics" && analytics ? (
        <AnalyticsPage analytics={analytics} />
      ) : (
        <section className="workspace-grid">
          {!focusMode && <aside className="sidebar">
            <div className="sidebar-heading">
              <span>Documents</span>
              <div className="sidebar-heading-actions">
                {workspace && <button type="button" className="document-sort"
                  onClick={() => setDocumentOrder(
                    (documentOrder ?? settings.documentOrder) === "newest" ? "oldest" : "newest",
                  )}
                  aria-label={(documentOrder ?? settings.documentOrder) === "newest"
                    ? "Sort documents oldest first" : "Sort documents newest first"}
                  title={(documentOrder ?? settings.documentOrder) === "newest"
                    ? "Newest filename date first. Click for oldest first."
                    : "Oldest filename date first. Click for newest first."}>
                  {(documentOrder ?? settings.documentOrder) === "newest" ? "↓" : "↑"}
                </button>}
                <span className="file-count">{workspace?.files.length ?? 0}</span>
              </div>
            </div>
            {workspace ? (
              <>
                <p className="workspace-path" title={workspace.root}>
                  <span>{workspace.root}</span>
                  <button
                    type="button"
                    className="forget-workspace"
                    onClick={forgetWorkspace}
                    disabled={busy}
                    title="Stop reopening this folder on startup"
                  >
                    Forget
                  </button>
                </p>
                <label className="document-search">
                  <span className="sr-only">Search documents</span>
                  <input
                    value={documentSearch}
                    onChange={(event) => setDocumentSearch(event.currentTarget.value)}
                    placeholder="Search documents"
                  />
                </label>
                <nav className="file-list" aria-label="Markdown documents">
                  {orderedFiles
                    .filter((path) => path.toLowerCase().includes(documentSearch.toLowerCase().trim()))
                    .map((path) => (
                    <button
                      className={document?.path === path ? "file-button active" : "file-button"}
                      key={path}
                      onClick={() => selectDocument(path)}
                      disabled={busy}
                    >
                      <span className="file-icon">¶</span>
                      <span>{path}</span>
                    </button>
                  ))}
                  {!workspace.files.some((path) =>
                    path.toLowerCase().includes(documentSearch.toLowerCase().trim()),
                  ) && (
                    <p className="empty-sidebar">No matching documents.</p>
                  )}
                </nav>
              </>
            ) : (
              <div className="empty-sidebar">
                Your Markdown files stay in a folder you control.
              </div>
            )}
          </aside>}

          <section className="editor-panel">
            {document ? (
              <>
                <div className="document-header">
                  <div className="document-heading">
                    <p className="eyebrow">Now writing</p>
                    <InlineNameEditor key={`title:${document.path}`} value={title}
                      display={title || "Untitled"} label="Writing title" busy={busy}
                      heading onRename={changeWritingTitle} />
                    <div className="document-filename">
                      <InlineNameEditor key={`file:${document.path}`}
                        value={(document.path.split(/[/\\]/).pop() ?? document.path).replace(/\.md$/i, "")}
                        display={document.path} label="File name" extension=".md"
                        busy={busy} onRename={renameDocument} />
                    </div>
                  </div>
                  <div className="document-actions">
                    <button
                      className="icon-button focus-button"
                      onClick={() => setFocusMode((current) => !current)}
                      aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
                      aria-pressed={focusMode}
                      title={focusMode ? "Exit focus mode (Escape)" : "Focus mode"}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={focusMode
                          ? "M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5"
                          : "M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"} />
                      </svg>
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        changeEditorMode(editorMode === "rich" ? "source" : "rich")
                      }
                    >
                      {editorMode === "rich" ? "Markdown source" : "Rich editor"}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void saveDocument()}
                      disabled={busy || (!contentChanged && !tagsChanged)}
                    >
                      {saving.current ? "Saving…" : !contentChanged && !tagsChanged ? "Saved" : "Save"}
                    </button>
                  </div>
                </div>
                {editorMode === "source" && (
                  <div className="formatting-bar" aria-label="Formatting controls">
                    <button onClick={() => wrapSelection("# ", "", "Heading")}>H1</button>
                    <button onClick={() => wrapSelection("## ", "", "Heading")}>H2</button>
                    <button onClick={() => wrapSelection("### ", "", "Heading")}>H3</button>
                    <span className="toolbar-divider" />
                    <button onClick={() => wrapSelection("**", "**")}><strong>B</strong></button>
                    <button onClick={() => wrapSelection("_", "_")}><em>I</em></button>
                    <button onClick={() => wrapSelection("<u>", "</u>")}><u>U</u></button>
                    <button onClick={() => wrapSelection("[", "](https://)", "link text")}>Link</button>
                  </div>
                )}
                <div className="tag-editor">
                  <label htmlFor="document-tags">Tags</label>
                  <input
                    id="document-tags"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.currentTarget.value)}
                    placeholder="essay, work, reflection"
                  />
                  <span className={tagsChanged ? "tag-save-state changed" : "tag-save-state"}>
                    {tagsChanged ? "Included in next save" : "Saved"}
                  </span>
                </div>
                <div className="writing-surface">
                  {editorMode === "source" ? (
                    <CodeMirror
                      ref={editorRef}
                      value={content}
                      theme={theme}
                      height="100%"
                      extensions={sourceExtensions}
                      onChange={setContent}
                      basicSetup={{
                        lineNumbers: false,
                        foldGutter: false,
                        highlightActiveLine: false,
                        highlightActiveLineGutter: false,
                      }}
                    />
                  ) : (
                    <RichMarkdownEditor
                      key={richEditorVersion}
                      markdown={splitMarkdownDocument(content).body}
                      onChange={updateRichContent}
                      editorRef={richEditorRef}
                      onError={setStatus}
                      spelling={spelling}
                      onSpelling={setSpellingRequest}
                    />
                  )}
                </div>
              </>
            ) : (
              <WelcomePanel
                restoring={restoring}
                restoreFailed={restoreFailed}
                busy={busy}
                onChooseWorkspace={chooseWorkspace}
                onForgetWorkspace={forgetWorkspace}
              />
            )}
          </section>
        </section>
      )}

      <footer className="statusbar">
        <span className={busy ? "status-dot busy" : "status-dot"} />
        <span>{busy ? "Working…" : status}</span>
        {saveError && <span role="alert">{saveError}</span>}
        {document && (contentChanged || tagsChanged) && <span className="unsaved">Unsaved changes</span>}
      </footer>

      {settingsOpen && <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {spellingRequest && <SpellingMenu request={spellingRequest} onClose={() => setSpellingRequest(null)} />}

      {creatingDocument && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="new-document-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-modal-title"
            onSubmit={createDocument}
          >
            <p className="eyebrow">
              New Markdown file
            </p>
            <h2 id="document-modal-title">Name your document</h2>
            <p>
              The title becomes the first heading. The file name is independent.
            </p>
            <label htmlFor="writing-title">Writing title</label>
            <input id="writing-title" className="title-input" autoFocus required
              placeholder="Reflections on Discipline"
              value={newTitle} onChange={(event) => {
                const value = event.currentTarget.value;
                setNewTitle(value);
                if (documentNameSuggested) setDocumentName(newFilename(value));
              }} />
            <label htmlFor="document-name">File name</label>
            <div className="file-name-input">
              <input
                id="document-name"
                required
                spellCheck={false}
                value={documentName}
                className={documentNameSuggested ? "suggested-value" : ""}
                onChange={(event) => {
                  setDocumentName(event.currentTarget.value);
                  setDocumentNameSuggested(false);
                }}
              />
              <span>.md</span>
            </div>
            <p className="filename-help">
              {documentNameSuggested ? `Suggested from your title, up to ${settings.filename.maxLength} characters${settings.filename.includeDate ? " including the date" : ""} and .md.` : "Custom file name. Changing the title will leave it unchanged."}
            </p>
            {!documentNameSuggested && <button type="button" className="text-button" onClick={() => {
              setDocumentName(newFilename(newTitle));
              setDocumentNameSuggested(true);
            }}>Use suggested file name</button>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeDocumentModal}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !documentName.trim() || !newTitle.trim()}
              >
                Create file
              </button>
            </div>
            {documentModalError && (
              <p className="modal-error" role="alert">{documentModalError}</p>
            )}
          </form>
        </div>
      )}
    </main>
  );
}

export default App;
