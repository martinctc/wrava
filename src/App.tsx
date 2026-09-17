import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { Crepe } from "@milkdown/crepe";
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
import {
  AnalyticsView,
  DocumentResult,
  DocumentView,
  WorkspaceView,
  emptyStats,
} from "./types";

function App() {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
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
  const [renamingDocument, setRenamingDocument] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [documentNameSuggested, setDocumentNameSuggested] = useState(false);
  const [documentModalError, setDocumentModalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose a folder to begin tracking your writing.");

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
    setStatus(`${next.wordCount.toLocaleString()} words`);
  }

  async function saveDocument() {
    if (!document || (!contentChanged && !tagsChanged)) return;
    const saved = await run(() => backendSaveDocument(document.path, content, parsedTags));
    applyDocumentResult(saved, true);
    setStatus("Saved and activity updated.");
  }

  async function createDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDocumentModalError("");
    try {
      const created = await run(() => backendCreateDocument(documentName));
      applyDocumentResult(created);
      setCreatingDocument(false);
      setStatus(`Created ${created.document.path}.`);
    } catch (error) {
      setDocumentModalError(String(error));
    }
  }

  async function renameDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;
    setDocumentModalError("");
    try {
      const renamed = await run(() => backendRenameDocument(document.path, documentName));
      applyDocumentResult(renamed);
      setRenamingDocument(false);
      setStatus(`Renamed to ${renamed.document.path}.`);
    } catch (error) {
      setDocumentModalError(String(error));
    }
  }

  function applyDocumentResult(result: DocumentResult, preserveEditorMode = false) {
    setWorkspace(result.workspace);
    setDocument(result.document);
    setContent(result.document.content);
    setSavedContent(result.document.content);
    setTagInput(result.document.tags.join(", "));
    setDocumentName("");
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

  function openRenameDialog() {
    if (!document || contentChanged || tagsChanged) return;
    const pathParts = document.path.split("/");
    const currentName = pathParts[pathParts.length - 1] ?? document.path;
    setDocumentName(currentName.replace(/\.md$/i, ""));
    setDocumentModalError("");
    setDocumentNameSuggested(false);
    setRenamingDocument(true);
  }

  function closeDocumentModal() {
    setCreatingDocument(false);
    setRenamingDocument(false);
    setDocumentName("");
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
    if (mode === "rich") {
      setRichEditorVersion((version) => version + 1);
    }
    setEditorMode(mode);
  }

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDocument();
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

  const shellClasses = [
    "app-shell",
    focusMode ? "focus-mode" : "",
    isDemoMode() && !focusMode ? "has-demo-banner" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClasses}>
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
              aria-current={page === "write" ? "page" : undefined}
            >
              Write
            </button>
            <button
              className="secondary-button focus-button"
              onClick={() => setFocusMode((current) => !current)}
              title="Press Escape to exit focus mode"
            >
              {focusMode ? "Exit focus" : "Focus"}
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
          {workspace && (
            <>
              <button
                className="secondary-button"
                onClick={() => {
                  if ((contentChanged || tagsChanged) && !window.confirm("Discard your unsaved changes and create a new document?")) {
                    return;
                  }
                  setDocumentName(`${localDatePrefix()} Untitled`);
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
                  <div>
                    <p className="eyebrow">Now writing</p>
                    <h1>{document.path}</h1>
                  </div>
                  <div className="document-actions">
                    <button
                      className="secondary-button"
                      onClick={openRenameDialog}
                      disabled={busy || contentChanged || tagsChanged}
                      title={contentChanged || tagsChanged ? "Save before renaming" : "Rename file"}
                    >
                      Rename
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
                      onClick={saveDocument}
                      disabled={busy || (!contentChanged && !tagsChanged)}
                    >
                      {!contentChanged && !tagsChanged ? "Saved" : "Save"}
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
                      height="100%"
                      extensions={[markdown(), EditorView.lineWrapping]}
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
                      key={`${document.path}:${richEditorVersion}`}
                      markdown={splitMarkdownDocument(content).body}
                      onChange={updateRichContent}
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
        {document && (contentChanged || tagsChanged) && <span className="unsaved">Unsaved changes</span>}
      </footer>

      {(creatingDocument || renamingDocument) && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="new-document-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-modal-title"
            onSubmit={renamingDocument ? renameDocument : createDocument}
          >
            <p className="eyebrow">
              {renamingDocument ? "Rename Markdown file" : "New Markdown file"}
            </p>
            <h2 id="document-modal-title">{renamingDocument ? "Choose a new name" : "Name your document"}</h2>
            <p>
              {renamingDocument
                ? "The file stays in its current folder and keeps its writing history."
                : `Wrava will create it as ${localDatePrefix()} Your title.md.`}
            </p>
            <label htmlFor="document-name">File name</label>
            <div className="file-name-input">
              <input
                id="document-name"
                autoFocus
                value={documentName}
                className={documentNameSuggested ? "suggested-value" : ""}
                onFocus={(event) => {
                  if (documentNameSuggested) event.currentTarget.select();
                }}
                onChange={(event) => {
                  setDocumentName(event.currentTarget.value);
                  setDocumentNameSuggested(false);
                }}
              />
              <span>.md</span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeDocumentModal}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !documentName.trim()}
              >
                {renamingDocument ? "Rename file" : "Create file"}
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
                <CartesianGrid stroke="#e5e7df" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  minTickGap={36}
                  tick={{ fill: "#777c73", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="words"
                  tick={{ fill: "#777c73", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="documents"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: "#777c73", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(label) => formatDate(String(label))}
                  contentStyle={{ borderRadius: 10, borderColor: "#d8dcd3" }}
                />
                <Line
                  type="monotone"
                  dataKey="wordsAdded"
                  name="Words added"
                  yAxisId="words"
                  stroke="#315b3a"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="netChange"
                  name="Net growth"
                  yAxisId="words"
                  stroke="#9a7550"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="activeDocuments"
                  name="Active documents"
                  yAxisId="documents"
                  stroke="#65758b"
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
}: {
  markdown: string;
  onChange: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(markdown);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!rootRef.current) return;

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
    crepe.on((listener) => {
      listener.markdownUpdated((_context, nextMarkdown, previousMarkdown) => {
        if (nextMarkdown !== previousMarkdown) {
          onChangeRef.current(nextMarkdown);
        }
      });
    });

    void crepe.create();
    return () => {
      void crepe.destroy();
    };
  }, []);

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

function localDatePrefix() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitMarkdownDocument(markdown: string) {
  const match = markdown.match(/^(---(?:\r?\n))[\s\S]*?(\r?\n---\r?\n)/);
  if (!match) {
    return { frontMatter: "", body: markdown };
  }
  const boundary = match[0].length;
  return {
    frontMatter: markdown.slice(0, boundary),
    body: markdown.slice(boundary),
  };
}

export default App;
