import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { closeHistory } from "@milkdown/kit/prose/history";
import { suggestedFilename, splitMarkdownDocument, writingTitle, withWritingTitle } from "./documentIdentity";
import { loadLocalSettings, SETTINGS_KEY, type Settings } from "./settings";
import { SettingsPanel } from "./SettingsPanel";
import { SpellingMenu } from "./SpellingMenu";
import { loadDictionary } from "./spellingDictionaries";
import type { SpellingChecker } from "./spellcheckCore";
import { sourceSpelling, richSpelling, richSpellingKey, type SpellingOptions, type SpellingRequest } from "./spellingEditors";
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
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  const [editorMode, setEditorMode] = useState<"rich" | "source">("rich");
  const [focusMode, setFocusMode] = useState(false);
  const [richEditorVersion, setRichEditorVersion] = useState(0);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [documentNameSuggested, setDocumentNameSuggested] = useState(false);
  const [documentModalError, setDocumentModalError] = useState("");
  const [busy, setBusy] = useState(false);
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
    return splitMarkdownDocument(content).frontMatter + richEditorRef.current.getMarkdown();
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
    const next = await run(() => openWorkspace(selected));
    setWorkspace(next);
    setDocument(null);
    setAnalytics(null);
    setContent("");
    setSavedContent("");
    setTagInput("");
    setDocumentSearch("");
    setFocusMode(false);
    setPage("write");
    setStatus(
      next.files.length
        ? `Tracking ${next.files.length} Markdown file${next.files.length === 1 ? "" : "s"}.`
        : "Workspace ready. Create your first Markdown file.",
    );
  }

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
        ? splitMarkdownDocument(latest.content).frontMatter + richEditorRef.current.getMarkdown()
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
    setContent((current) => {
      const { frontMatter } = splitMarkdownDocument(current);
      return `${frontMatter}${markdownBody}`;
    });
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

      {page === "write" && !focusMode ? (
        <section className="metric-strip" aria-label="Writing activity">
          <MetricCard label="Added today" value={stats.todayAdded} net={stats.todayNet} documents={stats.todayDocuments} />
          <MetricCard label="Added this week" value={stats.weekAdded} net={stats.weekNet} documents={stats.weekDocuments} />
          <MetricCard label="Added this month" value={stats.monthAdded} net={stats.monthNet} documents={stats.monthDocuments} />
          <MetricCard label="Added this year" value={stats.yearAdded} net={stats.yearNet} documents={stats.yearDocuments} />
        </section>
      ) : (
        <div className="metric-strip-compact" aria-label="Writing activity summary">
          <strong>{stats.todayAdded.toLocaleString()}</strong>
          <span>words added today</span>
          <span className={stats.todayNet < 0 ? "negative" : ""}>
            {stats.todayNet >= 0 ? "+" : ""}{stats.todayNet.toLocaleString()} net growth
          </span>
        </div>
      )}

      {page === "analytics" && analytics ? (
        <AnalyticsPage analytics={analytics} />
      ) : (
        <section className="workspace-grid">
          {!focusMode && <aside className="sidebar">
            <div className="sidebar-heading">
              <span>Documents</span>
              <span className="file-count">{workspace?.files.length ?? 0}</span>
            </div>
            {workspace ? (
              <>
                <p className="workspace-path" title={workspace.root}>{workspace.root}</p>
                <label className="document-search">
                  <span className="sr-only">Search documents</span>
                  <input
                    value={documentSearch}
                    onChange={(event) => setDocumentSearch(event.currentTarget.value)}
                    placeholder="Search documents"
                  />
                </label>
                <nav className="file-list" aria-label="Markdown documents">
                  {workspace.files
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
              <div className="welcome-panel">
                <div className="welcome-mark">W</div>
                <p className="eyebrow">Your words, your files</p>
                <h1>Make your writing visible.</h1>
                <p>
                  Choose a folder of Markdown files. Wrava will establish a baseline,
                  then track additions and document growth from every accepted change.
                </p>
                <button className="primary-button" onClick={chooseWorkspace} disabled={busy}>
                  Choose writing folder
                </button>
              </div>
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

function InlineNameEditor({ value, display, label, extension = "", heading = false, busy, onRename }: {
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

function AnalyticsPage({ analytics }: { analytics: AnalyticsView }) {
  const totalAdded = analytics.daily.reduce((sum, day) => sum + day.wordsAdded, 0);
  const totalNet = analytics.daily.reduce((sum, day) => sum + day.netChange, 0);
  const bestDay = analytics.daily.reduce(
    (best, day) => (day.wordsAdded > best.wordsAdded ? day : best),
    analytics.daily[0],
  );
  const maxDocumentWords = Math.max(
    1,
    ...analytics.documents.map((document) => document.wordsAdded),
  );

  return (
    <section className="analytics-page">
      <div className="analytics-heading">
        <div>
          <p className="eyebrow">Detailed analytics</p>
          <h1>Your last 12 weeks</h1>
          <p>Writing activity calculated from accepted Markdown changes.</p>
        </div>
      </div>

      <div className="analytics-summary">
        <SummaryCard label="Words added" value={totalAdded} detail={`${totalNet >= 0 ? "+" : ""}${totalNet.toLocaleString()} net growth`} />
        <SummaryCard label="Active days" value={analytics.activeDays} detail={`of ${analytics.daily.length} days`} />
        <SummaryCard label="Active documents" value={analytics.activeDocuments} detail={`${analytics.documents.length} in the workspace`} />
        <SummaryCard label="Current corpus" value={analytics.currentWordCount} detail={`${analytics.documents.length} documents`} />
        <SummaryCard
          label="Best writing day"
          value={bestDay?.wordsAdded ?? 0}
          detail={bestDay ? formatDate(bestDay.date) : "No activity yet"}
        />
      </div>

      <div className="analytics-grid">
        <article className="analytics-card trend-card">
          <div className="card-heading">
            <div>
              <h2>Writing activity</h2>
              <p>Daily additions and net document growth</p>
            </div>
            <span>12 weeks</span>
          </div>
          <div className="trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.daily} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  minTickGap={36}
                  tick={{ fill: "var(--chart-label)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="words"
                  tick={{ fill: "var(--chart-label)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="documents"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: "var(--chart-label)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(label) => formatDate(String(label))}
                  contentStyle={{ borderRadius: 10, borderColor: "var(--tooltip-border)", background: "var(--tooltip-background)", color: "var(--tooltip-text)" }}
                />
                <Line
                  type="monotone"
                  dataKey="wordsAdded"
                  name="Words added"
                  yAxisId="words"
                  stroke="var(--chart-added)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="netChange"
                  name="Net growth"
                  yAxisId="words"
                  stroke="var(--chart-net)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="activeDocuments"
                  name="Active documents"
                  yAxisId="documents"
                  stroke="var(--chart-documents)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span><i className="legend-added" /> Words added</span>
            <span><i className="legend-net" /> Net growth</span>
            <span><i className="legend-documents" /> Active documents</span>
          </div>
        </article>

        <article className="analytics-card consistency-card">
          <div className="card-heading">
            <div>
              <h2>Consistency</h2>
              <p>Each square is one day</p>
            </div>
          </div>
          <div className="activity-grid" aria-label="Writing activity heatmap">
            {analytics.daily.map((day) => (
              <span
                key={day.date}
                className={`activity-cell level-${activityLevel(day.wordsAdded)}`}
                title={`${formatDate(day.date)}: ${day.wordsAdded.toLocaleString()} words added`}
              />
            ))}
          </div>
          <p className="consistency-note">
            You wrote on <strong>{analytics.activeDays}</strong> of the last 84 days.
          </p>
        </article>

        <article className="analytics-card documents-card">
          <div className="card-heading">
            <div>
              <h2>Activity by document</h2>
              <p>All recorded activity for the current workspace</p>
            </div>
          </div>
          <div className="document-breakdown">
            {analytics.documents.length ? analytics.documents.map((item) => (
              <div className="document-row" key={item.path}>
                <div className="document-row-label">
                  <strong title={item.path}>{item.path}</strong>
                  <span>{item.wordsAdded.toLocaleString()} added · {item.currentWordCount.toLocaleString()} current</span>
                  {item.tags.length > 0 && (
                    <span className="document-tags">{item.tags.map((tag) => `#${tag}`).join(" ")}</span>
                  )}
                </div>
                <div className="document-bar-track">
                  <span
                    className={item.wordsAdded === 0 ? "document-bar zero" : "document-bar"}
                    style={{ width: `${item.wordsAdded === 0 ? 0 : item.wordsAdded / maxDocumentWords * 100}%` }}
                  />
                </div>
                <span className={item.netChange < 0 ? "document-net negative" : "document-net"}>
                  {item.netChange >= 0 ? "+" : ""}{item.netChange.toLocaleString()}
                </span>
              </div>
            )) : (
              <p className="empty-analytics">No documents have been indexed yet.</p>
            )}
          </div>
        </article>

        <article className="analytics-card tags-card">
          <div className="card-heading">
            <div>
              <h2>Activity by tag</h2>
              <p>Current tags applied to each document</p>
            </div>
          </div>
          <div className="tag-breakdown">
            {analytics.tags.length ? analytics.tags
              .slice()
              .sort((left, right) => right.wordsAdded - left.wordsAdded)
              .map((tag) => (
                <div className="tag-row" key={tag.tag}>
                  <span className="tag-pill">#{tag.tag}</span>
                  <strong>{tag.wordsAdded.toLocaleString()} words</strong>
                  <span>{tag.documents} document{tag.documents === 1 ? "" : "s"}</span>
                </div>
              )) : (
                <p className="empty-analytics">Add tags to documents to see topic-level activity.</p>
              )}
          </div>
        </article>
      </div>
    </section>
  );
}

function RichMarkdownEditor({
  markdown,
  onChange,
  editorRef,
  onError,
  spelling,
  onSpelling,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  editorRef: React.RefObject<Crepe | null>;
  onError: (message: string) => void;
  spelling: SpellingOptions;
  onSpelling: (request: SpellingRequest) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(markdown);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const spellingRef = useRef(spelling);
  spellingRef.current = spelling;
  const onSpellingRef = useRef(onSpelling);
  onSpellingRef.current = onSpelling;

  useEffect(() => {
    editorRef.current?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(richSpellingKey, "refresh"));
    });
  }, [editorRef, spelling]);

  useEffect(() => {
    if (!rootRef.current) return;
    let disposed = false;

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialMarkdownRef.current,
      features: {
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Table]: false,
        [Crepe.Feature.TopBar]: true,
      },
    });
    crepe.editor.use(richSpelling(() => spellingRef.current, request => onSpellingRef.current(request)));
    crepe.on((listener) => {
      listener.markdownUpdated((_context, nextMarkdown, previousMarkdown) => {
        if (!disposed && nextMarkdown !== previousMarkdown) {
          onChangeRef.current(nextMarkdown);
        }
      });
    });

    void crepe.create().then(() => {
      if (!disposed) editorRef.current = crepe;
    }).catch((error) => onErrorRef.current(`Could not start the rich editor: ${String(error)}`));
    return () => {
      disposed = true;
      if (editorRef.current === crepe) editorRef.current = null;
      void crepe.destroy().catch((error) => onErrorRef.current(`Could not close the rich editor: ${String(error)}`));
    };
  }, [editorRef]);

  return <div className="rich-editor" ref={rootRef} />;
}

function MetricCard({
  label,
  value,
  net,
  documents,
}: {
  label: string;
  value: number;
  net: number;
  documents: number;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small className={net < 0 ? "negative" : ""}>
        {net >= 0 ? "+" : ""}{net.toLocaleString()} document growth
      </small>
      <small className="document-count">
        {documents} active document{documents === 1 ? "" : "s"}
      </small>
    </article>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </article>
  );
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function activityLevel(words: number) {
  if (words === 0) return 0;
  if (words < 100) return 1;
  if (words < 300) return 2;
  if (words < 600) return 3;
  return 4;
}

export default App;
