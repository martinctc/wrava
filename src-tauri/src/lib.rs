use atomicwrites::{AllowOverwrite, AtomicFile, DisallowOverwrite};
use chrono::{Datelike, Local, NaiveDate};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use similar::{ChangeTag, TextDiff};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use unicode_segmentation::UnicodeSegmentation;
use walkdir::{DirEntry, WalkDir};

/// Written into the writing folder itself. It holds the stable identity that
/// keeps activity history attached to a folder across renames and moves.
const IDENTITY_FILE: &str = "wrava.json";
/// Written into every identity Wrava creates, so a `wrava.json` belonging to
/// some other program is never mistaken for one of ours.
const IDENTITY_MARKER: &str = "wrava-workspace";
const DATABASE_FILE: &str = "wrava.sqlite3";

#[derive(Default)]
struct AppState {
    workspace: Mutex<Option<Workspace>>,
}

struct Workspace {
    root: PathBuf,
    database: Connection,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceView {
    root: String,
    files: Vec<String>,
    stats: ActivityStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentView {
    path: String,
    content: String,
    word_count: usize,
    tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedDocumentView {
    workspace: WorkspaceView,
    document: DocumentView,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityStats {
    today_added: i64,
    week_added: i64,
    month_added: i64,
    year_added: i64,
    today_net: i64,
    week_net: i64,
    month_net: i64,
    year_net: i64,
    today_documents: i64,
    week_documents: i64,
    month_documents: i64,
    year_documents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BigramResult {
    phrase: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyticsView {
    daily: Vec<DailyActivity>,
    documents: Vec<DocumentActivity>,
    active_days: usize,
    active_documents: usize,
    current_word_count: i64,
    tags: Vec<TagActivity>,
    bigrams: Vec<BigramResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyActivity {
    date: String,
    words_added: i64,
    words_deleted: i64,
    net_change: i64,
    active_documents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentActivity {
    path: String,
    current_word_count: i64,
    words_added: i64,
    words_deleted: i64,
    net_change: i64,
    tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagActivity {
    tag: String,
    documents: usize,
    words_added: i64,
    words_deleted: i64,
    net_change: i64,
}

/// Why a workspace could not be opened, as a machine-readable code beside the
/// message shown to the writer.
///
/// The distinction matters because it decides whether Wrava forgets the
/// remembered folder: a folder that is gone should be forgotten, while a
/// disconnected drive or a locked database should be retried next launch.
#[derive(Serialize)]
struct WorkspaceOpenError {
    code: &'static str,
    message: String,
}

impl WorkspaceOpenError {
    fn missing(message: impl Into<String>) -> Self {
        Self {
            code: "folder_missing",
            message: message.into(),
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            code: "workspace_open_failed",
            message: message.into(),
        }
    }
}

#[tauri::command]
fn open_workspace(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<WorkspaceView, WorkspaceOpenError> {
    // Only the folder itself being absent is `folder_missing`. Every other
    // failure — a disconnected drive, a sync client holding a lock, a database
    // error — is `workspace_open_failed`, because the frontend forgets the
    // remembered folder on the first and retries the second. Deciding that here,
    // from the actual io::ErrorKind, keeps the frontend from having to recognise
    // an operating system's message wording, which is localised.
    let root = fs::canonicalize(&path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => WorkspaceOpenError::missing(display_error(error)),
        _ => WorkspaceOpenError::failed(display_error(error)),
    })?;
    if !root.is_dir() {
        return Err(WorkspaceOpenError::missing(
            "The selected workspace is not a folder.",
        ));
    }

    // The stable identity lives in the folder itself so history survives
    // renames and moves. When it cannot be used — read-only folder, or a
    // wrava.json Wrava did not write — fall back to the old path-derived key,
    // which is exactly how the app behaved before identities existed.
    let legacy_key = content_hash(root.to_string_lossy().as_ref());
    let stable_key = ensure_identity(&root).map(|identity| content_hash(&identity.id));
    let workspaces = app
        .path()
        .app_local_data_dir()
        .map_err(|error| WorkspaceOpenError::failed(display_error(error)))?
        .join("workspaces");
    let database_path = resolve_database_path(&workspaces, stable_key.as_deref(), &legacy_key)
        .map_err(WorkspaceOpenError::failed)?;
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| WorkspaceOpenError::failed(display_error(error)))?;
    }

    let database = open_database(&database_path).map_err(WorkspaceOpenError::failed)?;
    initialize_database(&database).map_err(WorkspaceOpenError::failed)?;
    let mut workspace = Workspace { root, database };
    reconcile(&mut workspace).map_err(WorkspaceOpenError::failed)?;
    let view = workspace_view(&workspace).map_err(WorkspaceOpenError::failed)?;
    *state
        .workspace
        .lock()
        .map_err(|error| WorkspaceOpenError::failed(display_error(error)))? = Some(workspace);
    Ok(view)
}

#[tauri::command]
fn refresh_workspace(state: State<AppState>) -> Result<WorkspaceView, String> {
    with_workspace(&state, |workspace| {
        reconcile(workspace)?;
        workspace_view(workspace)
    })
}

#[tauri::command]
fn read_document(state: State<AppState>, path: String) -> Result<DocumentView, String> {
    with_workspace(&state, |workspace| {
        let full_path = resolve_document_path(&workspace.root, &path)?;
        let content = fs::read_to_string(&full_path).map_err(display_error)?;
        Ok(DocumentView {
            path,
            word_count: prose_words(&content).len(),
            tags: document_tags(&content),
            content,
        })
    })
}

#[tauri::command]
fn save_document(
    state: State<AppState>,
    path: String,
    content: String,
    tags: Vec<String>,
) -> Result<CreatedDocumentView, String> {
    with_workspace(&state, |workspace| {
        let full_path = resolve_document_path(&workspace.root, &path)?;
        let tags = normalize_tags(tags);
        let updated_content = set_document_tags(&content, &tags);
        AtomicFile::new(&full_path, AllowOverwrite)
            .write(|file| file.write_all(updated_content.as_bytes()))
            .map_err(display_error)?;
        accept_file(workspace, &path, &updated_content, "wrava")?;
        Ok(CreatedDocumentView {
            workspace: workspace_view(workspace)?,
            document: DocumentView {
                path,
                word_count: prose_words(&updated_content).len(),
                tags,
                content: updated_content,
            },
        })
    })
}

#[tauri::command]
fn create_document(
    state: State<AppState>,
    name: String,
    title: String,
) -> Result<CreatedDocumentView, String> {
    with_workspace(&state, |workspace| {
        create_workspace_document(workspace, &name, &title)
    })
}

fn create_workspace_document(
    workspace: &mut Workspace,
    name: &str,
    title: &str,
) -> Result<CreatedDocumentView, String> {
    let path = document_name(name)?;
    let full_path = resolve_document_path(&workspace.root, &path)?;
    let content = new_document_content(title)?;

    AtomicFile::new(&full_path, DisallowOverwrite)
        .write(|file| file.write_all(content.as_bytes()))
        .map_err(|error| {
            if full_path.exists() {
                format!("A document named \"{path}\" already exists.")
            } else {
                display_error(error)
            }
        })?;
    accept_file(workspace, &path, &content, "wrava")?;

    Ok(CreatedDocumentView {
        workspace: workspace_view(workspace)?,
        document: DocumentView {
            path,
            word_count: prose_words(&content).len(),
            tags: Vec::new(),
            content,
        },
    })
}

#[tauri::command]
fn rename_document(
    state: State<AppState>,
    path: String,
    name: String,
) -> Result<CreatedDocumentView, String> {
    with_workspace(&state, |workspace| {
        let source_path = resolve_document_path(&workspace.root, &path)?;
        let file_name = document_name(&name)?;
        let parent = Path::new(&path).parent().unwrap_or_else(|| Path::new(""));
        let renamed_path = parent.join(file_name).to_string_lossy().replace('\\', "/");

        if renamed_path == path {
            return Err("The document already has that name.".into());
        }

        let target_path = resolve_document_path(&workspace.root, &renamed_path)?;
        if target_path.exists() {
            return Err(format!(
                "A document named \"{}\" already exists in this folder.",
                target_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ));
        }

        let content = fs::read_to_string(&source_path).map_err(display_error)?;
        fs::rename(&source_path, &target_path).map_err(display_error)?;

        let transaction = workspace.database.transaction().map_err(|error| {
            let _ = fs::rename(&target_path, &source_path);
            display_error(error)
        })?;
        let database_result = (|| -> Result<(), rusqlite::Error> {
            transaction.execute(
                "UPDATE documents SET path = ?1 WHERE path = ?2",
                params![renamed_path, path],
            )?;
            transaction.execute(
                "UPDATE activity_events SET path = ?1 WHERE path = ?2",
                params![renamed_path, path],
            )?;
            transaction.commit()
        })();

        if let Err(error) = database_result {
            let rollback_result = fs::rename(&target_path, &source_path);
            return Err(match rollback_result {
                Ok(()) => display_error(error),
                Err(rollback_error) => format!(
                    "The file was renamed but its history could not be updated: {error}. \
                     The automatic file rollback also failed: {rollback_error}"
                ),
            });
        }

        Ok(CreatedDocumentView {
            workspace: workspace_view(workspace)?,
            document: DocumentView {
                path: renamed_path,
                word_count: prose_words(&content).len(),
                tags: document_tags(&content),
                content,
            },
        })
    })
}

#[tauri::command]
fn query_analytics(state: State<AppState>) -> Result<AnalyticsView, String> {
    with_workspace(&state, |workspace| analytics_view(&workspace.database))
}

/// Finds documents whose text contains `query`, so a writer can look for what
/// they wrote rather than only for what they named the file. File-name
/// matching stays in the sidebar, which already has every path in hand; this
/// walks the workspace for the half the frontend cannot see.
#[tauri::command]
fn search_document_content(state: State<AppState>, query: String) -> Result<Vec<String>, String> {
    with_workspace(&state, |workspace| search_content(&workspace.root, &query))
}

fn with_workspace<T>(
    state: &State<AppState>,
    operation: impl FnOnce(&mut Workspace) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.workspace.lock().map_err(display_error)?;
    let workspace = guard
        .as_mut()
        .ok_or_else(|| "Select a workspace first.".to_string())?;
    operation(workspace)
}

fn initialize_database(database: &Connection) -> Result<(), String> {
    database
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS documents (
                path TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL,
                content TEXT NOT NULL,
                word_count INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS activity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                local_date TEXT NOT NULL,
                source TEXT NOT NULL,
                words_added INTEGER NOT NULL,
                words_deleted INTEGER NOT NULL,
                net_change INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS activity_events_date
                ON activity_events(local_date);
            ",
        )
        .map_err(display_error)
}

fn workspace_view(workspace: &Workspace) -> Result<WorkspaceView, String> {
    Ok(WorkspaceView {
        root: display_root(&workspace.root),
        files: markdown_files(&workspace.root)?,
        stats: activity_stats(&workspace.database)?,
    })
}

fn reconcile(workspace: &mut Workspace) -> Result<(), String> {
    for path in markdown_files(&workspace.root)? {
        let full_path = resolve_document_path(&workspace.root, &path)?;
        let content = fs::read_to_string(full_path).map_err(display_error)?;
        accept_file(workspace, &path, &content, "external")?;
    }
    Ok(())
}

fn accept_file(
    workspace: &mut Workspace,
    path: &str,
    content: &str,
    source: &str,
) -> Result<(), String> {
    let hash = content_hash(content);
    let previous: Option<(String, String, i64)> = workspace
        .database
        .query_row(
            "SELECT content_hash, content, word_count FROM documents WHERE path = ?1",
            [path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(display_error)?;

    if previous.as_ref().is_some_and(|value| value.0 == hash) {
        return Ok(());
    }

    let current_words = prose_words(content);
    let now = Local::now();
    let transaction = workspace.database.transaction().map_err(display_error)?;

    if let Some((_, previous_content, previous_count)) = previous {
        let previous_plain = prose_words(&previous_content).join(" ");
        let current_plain = current_words.join(" ");
        let diff = TextDiff::from_words(&previous_plain, &current_plain);
        let mut added = 0_i64;
        let mut deleted = 0_i64;

        for change in diff.iter_all_changes() {
            let count = change.value().unicode_words().count() as i64;
            match change.tag() {
                ChangeTag::Insert => added += count,
                ChangeTag::Delete => deleted += count,
                ChangeTag::Equal => {}
            }
        }

        transaction
            .execute(
                "INSERT INTO activity_events
                 (path, local_date, source, words_added, words_deleted, net_change, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    path,
                    now.date_naive().to_string(),
                    source,
                    added,
                    deleted,
                    current_words.len() as i64 - previous_count,
                    now.to_rfc3339(),
                ],
            )
            .map_err(display_error)?;
    }

    transaction
        .execute(
            "INSERT INTO documents (path, content_hash, content, word_count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET
               content_hash = excluded.content_hash,
               content = excluded.content,
               word_count = excluded.word_count,
               updated_at = excluded.updated_at",
            params![
                path,
                hash,
                content,
                current_words.len() as i64,
                now.to_rfc3339(),
            ],
        )
        .map_err(display_error)?;
    transaction.commit().map_err(display_error)
}

fn activity_stats(database: &Connection) -> Result<ActivityStats, String> {
    let today = Local::now().date_naive();
    let week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let month_start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .ok_or_else(|| "Could not calculate the start of the month.".to_string())?;
    let year_start = NaiveDate::from_ymd_opt(today.year(), 1, 1)
        .ok_or_else(|| "Could not calculate the start of the year.".to_string())?;

    let totals = |start: NaiveDate| -> Result<(i64, i64, i64), String> {
        database
            .query_row(
                "SELECT COALESCE(SUM(words_added), 0),
                        COALESCE(SUM(net_change), 0),
                        COUNT(DISTINCT CASE
                          WHEN words_added > 0 OR words_deleted > 0 THEN path
                        END)
                 FROM activity_events WHERE local_date >= ?1",
                [start.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(display_error)
    };

    let today_totals = totals(today)?;
    let week_totals = totals(week_start)?;
    let month_totals = totals(month_start)?;
    let year_totals = totals(year_start)?;
    Ok(ActivityStats {
        today_added: today_totals.0,
        today_net: today_totals.1,
        week_added: week_totals.0,
        week_net: week_totals.1,
        month_added: month_totals.0,
        month_net: month_totals.1,
        year_added: year_totals.0,
        year_net: year_totals.1,
        today_documents: today_totals.2,
        week_documents: week_totals.2,
        month_documents: month_totals.2,
        year_documents: year_totals.2,
    })
}

fn analytics_view(database: &Connection) -> Result<AnalyticsView, String> {
    let today = Local::now().date_naive();
    let start = today - chrono::Duration::days(83);
    let mut daily = BTreeMap::new();
    for offset in 0..84 {
        let date = start + chrono::Duration::days(offset);
        daily.insert(
            date,
            DailyActivity {
                date: date.to_string(),
                words_added: 0,
                words_deleted: 0,
                net_change: 0,
                active_documents: 0,
            },
        );
    }

    let mut daily_statement = database
        .prepare(
            "SELECT local_date, SUM(words_added), SUM(words_deleted), SUM(net_change),
                    COUNT(DISTINCT CASE
                      WHEN words_added > 0 OR words_deleted > 0 THEN path
                    END)
             FROM activity_events
             WHERE local_date >= ?1
             GROUP BY local_date
             ORDER BY local_date",
        )
        .map_err(display_error)?;
    let daily_rows = daily_statement
        .query_map([start.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(display_error)?;
    for row in daily_rows {
        let (date, words_added, words_deleted, net_change, active_documents) =
            row.map_err(display_error)?;
        let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(display_error)?;
        if let Some(activity) = daily.get_mut(&parsed_date) {
            activity.words_added = words_added;
            activity.words_deleted = words_deleted;
            activity.net_change = net_change;
            activity.active_documents = active_documents;
        }
    }

    let mut document_statement = database
        .prepare(
            "SELECT d.path, d.word_count,
                    COALESCE(SUM(a.words_added), 0),
                    COALESCE(SUM(a.words_deleted), 0),
                    COALESCE(SUM(a.net_change), 0)
             FROM documents d
             LEFT JOIN activity_events a ON a.path = d.path
             GROUP BY d.path, d.word_count
             ORDER BY COALESCE(SUM(a.words_added), 0) DESC, d.path",
        )
        .map_err(display_error)?;
    let document_rows = document_statement
        .query_map([], |row| {
            Ok(DocumentActivity {
                path: row.get(0)?,
                current_word_count: row.get(1)?,
                words_added: row.get(2)?,
                words_deleted: row.get(3)?,
                net_change: row.get(4)?,
                tags: Vec::new(),
            })
        })
        .map_err(display_error)?;
    let mut documents = document_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(display_error)?;
    let mut tags = BTreeMap::<String, TagActivity>::new();
    let mut document_contents: Vec<String> = Vec::new();
    for document in &mut documents {
        let content: String = database
            .query_row(
                "SELECT content FROM documents WHERE path = ?1",
                [&document.path],
                |row| row.get(0),
            )
            .map_err(display_error)?;
        document.tags = document_tags(&content);
        document_contents.push(content.clone());
        for tag in &document.tags {
            let activity = tags
                .entry(tag.to_lowercase())
                .or_insert_with(|| TagActivity {
                    tag: tag.clone(),
                    documents: 0,
                    words_added: 0,
                    words_deleted: 0,
                    net_change: 0,
                });
            activity.documents += 1;
            activity.words_added += document.words_added;
            activity.words_deleted += document.words_deleted;
            activity.net_change += document.net_change;
        }
    }
    let daily = daily.into_values().collect::<Vec<_>>();
    let active_days = daily
        .iter()
        .filter(|day| day.words_added > 0 || day.words_deleted > 0)
        .count();
    let current_word_count = documents
        .iter()
        .map(|document| document.current_word_count)
        .sum();
    let active_documents = documents
        .iter()
        .filter(|document| document.words_added > 0 || document.words_deleted > 0)
        .count();

    let bigrams = compute_bigrams(&document_contents);

    Ok(AnalyticsView {
      daily,
      documents,
      active_days,
      active_documents,
      current_word_count,
      tags: tags.into_values().collect(),
      bigrams,
    })
}

fn prose_words(markdown: &str) -> Vec<String> {
    let body = strip_front_matter(markdown);
    let mut words = Vec::new();
    let mut code_depth = 0_u32;

    for event in Parser::new(body) {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_depth += 1,
            Event::End(TagEnd::CodeBlock) => code_depth = code_depth.saturating_sub(1),
            Event::Text(text) if code_depth == 0 => {
                words.extend(text.unicode_words().map(str::to_lowercase));
            }
            _ => {}
        }
    }
    words
}

const STOPWORDS: &[&str] = &[
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our",
  "out", "day", "get", "have", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who",
  "boy", "did", "its", "let", "put", "say", "she", "too", "use", "many", "over", "such", "take", "than",
  "them", "well", "were", "that", "with", "this", "from", "they", "know", "want", "been", "good", "much",
  "some", "time", "very", "when", "make", "like", "will", "just", "first", "other", "after", "back", "little",
  "only", "there", "their", "what", "which", "while", "world", "would", "think", "where", "being", "every",
  "great", "through", "during", "before", "should", "each", "find", "work", "part", "life", "call", "come",
  "also", "more", "around", "another", "most", "around", "between", "under", "right", "left", "high", "low",
  "early", "late", "here", "why", "all", "few", "more", "most", "other", "some", "such", "no", "nor", "only",
  "own", "same", "so", "too", "am", "is", "was", "were", "be", "been", "being", "have", "has", "had", "do",
  "does", "did", "done", "doing", "would", "could", "should", "may", "might", "must", "need", "dare", "ought",
  "used", "got", "go", "going", "went", "gone", "leave", "leaving", "left", "feel", "feeling", "felt", "try",
  "trying", "tried", "help", "helping", "helped", "show", "showing", "showed", "hear", "hearing", "heard", "play",
  "playing", "played", "run", "running", "ran", "move", "moving", "moved", "live", "living", "lived", "believe",
  "believing", "believed", "bring", "bringing", "brought", "happen", "happening", "happened", "stand", "standing",
  "stood", "lose", "losing", "lost", "pay", "paying", "paid", "meet", "meeting", "met", "include", "including",
  "included", "continue", "continuing", "continued", "set", "setting", "learn", "learning", "learned", "change",
  "changing", "changed", "lead", "leading", "led", "understand", "understanding", "understood", "watch", "watching",
  "watched", "follow", "following", "followed", "stop", "stopping", "stopped", "create", "creating", "created",
  "speak", "speaking", "spoke", "spoken", "read", "reading", "allow", "allowing", "allowed", "add", "adding", "added",
  "spend", "spending", "spent", "grow", "growing", "grew", "grown", "open", "opening", "opened", "walk", "walking",
  "walked", "win", "winning", "offer", "offering", "offered", "remember", "remembering", "remembered", "love",
  "loving", "loved", "consider", "considering", "considered", "appear", "appearing", "appeared", "buy", "buying",
  "bought", "wait", "waiting", "waited", "serve", "serving", "served", "die", "dying", "died", "send", "sending",
  "sent", "expect", "expecting", "expected", "build", "building", "built", "stay", "staying", "stayed", "fall",
  "falling", "fell", "fallen", "cut", "cutting", "reach", "reaching", "reached", "kill", "killing", "killed",
  "remain", "remaining", "remained", "suggest", "suggesting", "suggested", "raise", "raising", "raised", "pass",
  "passing", "passed", "sell", "selling", "sold", "require", "requiring", "required", "report", "reporting",
  "reported", "decide", "deciding", "decided", "pull", "pulling", "pulled",
];

fn compute_bigrams(contents: &[String]) -> Vec<BigramResult> {
    let stop_set: std::collections::HashSet<&str> = STOPWORDS.iter().cloned().collect();
    let mut counts: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for content in contents {
        let body = strip_front_matter(content);
        let words = prose_words(body);
        let filtered: Vec<&str> = words
            .iter()
            .filter(|w| w.len() >= 3 && !stop_set.contains(w.as_str()))
            .map(|w| w.as_str())
            .collect();
        for window in filtered.windows(2) {
            let phrase = format!("{} {}", window[0], window[1]);
            *counts.entry(phrase).or_insert(0) += 1;
        }
    }
    let mut results: Vec<(String, i64)> = counts.into_iter().collect();
    results.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    results.into_iter().take(8).map(|(phrase, count)| BigramResult { phrase, count }).collect()
}

fn strip_front_matter(markdown: &str) -> &str {
    let normalized = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    if !normalized.starts_with("---\n") && !normalized.starts_with("---\r\n") {
        return normalized;
    }

    let mut offset = 0;
    for line in normalized.split_inclusive('\n') {
        offset += line.len();
        if offset > 4 && line.trim_end_matches(['\r', '\n']) == "---" {
            return &normalized[offset..];
        }
    }
    normalized
}

fn markdown_files(root: &Path) -> Result<Vec<String>, String> {
    Ok(markdown_entries(root)?
        .into_iter()
        .map(|(path, _)| path)
        .collect())
}

/// Every visible Markdown document, as the relative path the app shows and a
/// full path to read. Both the folder listing and the content search walk the
/// workspace exactly once and in exactly one way: the same `WalkDir`, the same
/// `visible_entry`, the same `.md` test, the same ordering.
///
/// The relative path is derived from a path the walker itself produced beneath
/// `root`, so it carries no `ParentDir` or prefix component and always ends in
/// `.md` — it is exactly what `resolve_document_path` accepts, and it is the
/// same string the sidebar already sends back to open the document. Nothing
/// here re-decides what a path may be.
fn markdown_entries(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(visible_entry)
    {
        let entry = entry.map_err(display_error)?;
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            let relative = entry.path().strip_prefix(root).map_err(display_error)?;
            files.push((
                relative.to_string_lossy().replace('\\', "/"),
                entry.path().to_path_buf(),
            ));
        }
    }
    files.sort_by_key(|(path, _)| path.to_lowercase());
    Ok(files)
}

fn visible_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.') && name != "node_modules"
}

/// Shortest query worth walking a workspace for. Below this the sidebar keeps
/// filtering by file name — which costs nothing — and asks for nothing here.
/// One character matches most of a large folder, so it costs the same as a whole
/// phrase and finds little the name filter was not already showing. The demo
/// backend applies the same floor, so the two cannot disagree about what a one
/// letter query does.
const MIN_CONTENT_SEARCH_CHARS: usize = 2;

/// Longer than any search a person types, and cheap to check: the query is
/// lowercased before it is used, so an unbounded string would be allocated
/// before it was ever rejected.
const MAX_CONTENT_SEARCH_CHARS: usize = 256;

fn search_content(root: &Path, query: &str) -> Result<Vec<String>, String> {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < MIN_CONTENT_SEARCH_CHARS {
        return Ok(Vec::new());
    }
    if needle.len() > MAX_CONTENT_SEARCH_CHARS {
        return Err("That search is too long.".into());
    }

    let mut matches = Vec::new();
    for (relative, full_path) in markdown_entries(root)? {
        // A document that cannot be read right now — half-written by a sync
        // client, held open by another program, not text at all — is skipped
        // rather than failing the whole search. The sidebar is a convenience;
        // one unreadable file must not cost the user every other match.
        match fs::read_to_string(&full_path) {
            Ok(content) => {
                if searchable_body(&content).to_lowercase().contains(&needle) {
                    matches.push(relative);
                }
            }
            Err(_) => continue,
        }
    }
    Ok(matches)
}

/// The text of a document a search is allowed to find, which is everything the
/// writer typed and nothing the app typed for them. A `tags:` block is
/// metadata, so no document is found merely because it carries a tag.
///
/// This borrows rather than copies, and reads the body through the same
/// `front_matter` that `document_tags` uses, which is what makes the desktop app
/// and the demo agree about which documents have metadata at all.
fn searchable_body(content: &str) -> &str {
    match front_matter(content) {
        Some((_, body)) => body,
        None => content,
    }
}

/// Far longer than any real document path, and cheap to check: a caller that
/// sends a megabyte of text should not make the process allocate for it.
const MAX_DOCUMENT_PATH_BYTES: usize = 4096;

fn resolve_document_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    // Rejected before the path is parsed. A NUL byte truncates the path for
    // every Win32 call that follows, and an unbounded string is a denial of
    // service dressed up as a file name.
    if relative.len() > MAX_DOCUMENT_PATH_BYTES || relative.contains('\0') {
        return Err("The requested document path is not allowed.".into());
    }

    let relative_path = Path::new(relative);
    // Traversal is decided per component, not per character. A textual ".."
    // check would reject legitimate names such as "draft..notes.md", so the
    // Component::ParentDir test below is the whole defence.
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
        || !relative_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err("The requested document path is not allowed.".into());
    }

    let path = root.join(relative_path);
    let parent = path
        .parent()
        .ok_or_else(|| "The requested document has no parent folder.".to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(display_error)?;
    if !canonical_parent.starts_with(root) {
        return Err("The requested document is outside the workspace.".into());
    }
    Ok(path)
}

fn document_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let without_extension = if trimmed.to_ascii_lowercase().ends_with(".md") {
        &trimmed[..trimmed.len() - 3]
    } else {
        trimmed
    }
    .trim();

    if without_extension.is_empty() {
        return Err("Enter a name for the new document.".into());
    }
    if without_extension == "."
        || without_extension.ends_with('.')
        || without_extension.ends_with(' ')
        || without_extension.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return Err("Use a file name without slashes or Windows-reserved characters.".into());
    }

    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.iter().any(|reserved_name| {
        without_extension
            .split('.')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case(reserved_name)
    }) {
        return Err("That name is reserved by Windows. Choose another name.".into());
    }

    if without_extension.encode_utf16().count() + 3 > 255 {
        return Err("Use a file name of at most 255 characters including .md.".into());
    }
    Ok(format!("{without_extension}.md"))
}

fn new_document_content(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() || title.contains(['\r', '\n']) {
        return Err("Enter a title on a single line.".into());
    }
    let mut escaped = String::new();
    for character in title.chars() {
        if matches!(
            character,
            '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '#' | '~'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    Ok(format!("# {escaped}\n\n"))
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = BTreeMap::new();
    for tag in tags {
        let trimmed = tag.trim();
        if !trimmed.is_empty() {
            normalized
                .entry(trimmed.to_lowercase())
                .or_insert_with(|| trimmed.to_string());
        }
    }
    normalized.into_values().collect()
}

fn document_tags(content: &str) -> Vec<String> {
    let Some((front_matter, _)) = front_matter(content) else {
        return Vec::new();
    };
    let lines = front_matter.lines().collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        if let Some(value) = line.strip_prefix("tags:") {
            let inline = value.trim();
            if inline.starts_with('[') && inline.ends_with(']') {
                return normalize_tags(
                    inline[1..inline.len() - 1]
                        .split(',')
                        .map(clean_yaml_tag)
                        .collect(),
                );
            }
            if !inline.is_empty() {
                return normalize_tags(vec![clean_yaml_tag(inline)]);
            }

            let mut tags = Vec::new();
            for next_line in lines.iter().skip(index + 1) {
                let trimmed = next_line.trim();
                if let Some(tag) = trimmed.strip_prefix("- ") {
                    tags.push(clean_yaml_tag(tag));
                } else if !trimmed.is_empty()
                    && !next_line.starts_with(' ')
                    && !next_line.starts_with('\t')
                {
                    break;
                }
            }
            return normalize_tags(tags);
        }
    }
    Vec::new()
}

fn set_document_tags(content: &str, tags: &[String]) -> String {
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let tag_block = if tags.is_empty() {
        String::new()
    } else {
        format!(
            "tags:{newline}{}{newline}",
            tags.iter()
                .map(|tag| format!("  - {}", yaml_tag(tag)))
                .collect::<Vec<_>>()
                .join(newline)
        )
    };

    if let Some((front_matter, body)) = front_matter(content) {
        let lines = front_matter.lines().collect::<Vec<_>>();
        let mut output = Vec::new();
        let mut index = 0;
        let mut replaced = false;
        while index < lines.len() {
            if lines[index].starts_with("tags:") {
                replaced = true;
                index += 1;
                while index < lines.len()
                    && (lines[index].trim().is_empty()
                        || lines[index].starts_with(' ')
                        || lines[index].starts_with('\t')
                        || lines[index].trim_start().starts_with("- "))
                {
                    index += 1;
                }
                if !tag_block.is_empty() {
                    output.extend(tag_block.trim_end().lines().map(str::to_string));
                }
            } else {
                output.push(lines[index].to_string());
                index += 1;
            }
        }
        if !replaced && !tag_block.is_empty() {
            output.extend(tag_block.trim_end().lines().map(str::to_string));
        }
        return format!(
            "---{newline}{}{newline}---{newline}{body}",
            output.join(newline)
        );
    }

    if tags.is_empty() {
        content.to_string()
    } else {
        format!("---{newline}{tag_block}---{newline}{content}")
    }
}

fn front_matter(content: &str) -> Option<(&str, &str)> {
    let (newline, opening_length) = if content.starts_with("---\r\n") {
        ("\r\n", 5)
    } else if content.starts_with("---\n") {
        ("\n", 4)
    } else {
        return None;
    };
    let fence = format!("{newline}---");
    let search = &content[opening_length..];
    // The closing fence is a line of its own, and the last line of a file needs no
    // newline after it: `---\ntags: [essay]\n---` is valid front matter. Requiring a
    // trailing newline here dropped the tags of every metadata-only document, and the
    // TypeScript splitter's `|$` alternative does accept end-of-input, so the two sides
    // disagreed about which documents had metadata at all. Take the first fence whose
    // remainder is either another line or the end of the file, so a body that merely
    // starts with `---` (a horizontal rule) is still not mistaken for the close.
    let closing_index = search
        .match_indices(&fence)
        .find(|(index, _)| {
            let rest = &search[index + fence.len()..];
            rest.is_empty() || rest.starts_with(newline)
        })
        .map(|(index, _)| index + opening_length)?;
    let rest = &content[closing_index + fence.len()..];
    let body_start = if rest.starts_with(newline) {
        closing_index + fence.len() + newline.len()
    } else {
        content.len()
    };
    Some((
        &content[opening_length..closing_index],
        &content[body_start..],
    ))
}

fn clean_yaml_tag(value: &str) -> String {
    value
        .trim()
        .trim_matches(|character| character == '"' || character == '\'')
        .to_string()
}

fn yaml_tag(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_' | ' '))
    {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

#[derive(Serialize, Deserialize)]
struct WorkspaceIdentity {
    /// Marks the file as Wrava's own. Its absence means the file belongs to
    /// something else, whatever else it happens to contain.
    written_by: String,
    id: String,
    root: String,
}

fn new_identity(root: &str) -> WorkspaceIdentity {
    WorkspaceIdentity {
        written_by: IDENTITY_MARKER.to_string(),
        id: new_workspace_id(),
        root: root.to_string(),
    }
}

enum IdentityFile {
    Missing,
    Recognised(WorkspaceIdentity),
    /// Present, but not an identity Wrava wrote. Never overwritten.
    Unrecognised,
}

fn identity_path(root: &Path) -> PathBuf {
    root.join(IDENTITY_FILE)
}

fn read_identity(root: &Path) -> IdentityFile {
    match fs::read_to_string(identity_path(root)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => IdentityFile::Missing,
        Err(_) => IdentityFile::Unrecognised,
        Ok(contents) => match serde_json::from_str::<WorkspaceIdentity>(&contents) {
            // Only a file Wrava wrote counts. Without this check any unrelated
            // `wrava.json` that happened to carry an `id` field would be taken
            // as an identity, and the activity database would be migrated onto
            // it — a surprising outcome for a file the app did not write.
            Ok(identity)
                if identity.written_by == IDENTITY_MARKER && !identity.id.trim().is_empty() =>
            {
                IdentityFile::Recognised(identity)
            }
            _ => IdentityFile::Unrecognised,
        },
    }
}

fn write_identity(root: &Path, identity: &WorkspaceIdentity, overwrite: bool) -> Option<()> {
    let contents = format!("{}\n", serde_json::to_string_pretty(identity).ok()?);
    let behavior = if overwrite {
        AllowOverwrite
    } else {
        DisallowOverwrite
    };
    AtomicFile::new(identity_path(root), behavior)
        .write(|file| file.write_all(contents.as_bytes()))
        .ok()
}

/// Resolves which stable identity this folder should keep.
///
/// Returns `None` only when Wrava cannot record one, in which case the caller
/// falls back to the path-derived database key.
fn ensure_identity(root: &Path) -> Option<WorkspaceIdentity> {
    let stored_root = display_root(root);
    match read_identity(root) {
        IdentityFile::Unrecognised => None,
        IdentityFile::Missing => {
            let identity = new_identity(&stored_root);
            write_identity(root, &identity, false)?;
            Some(identity)
        }
        IdentityFile::Recognised(existing) => {
            let recorded = fs::canonicalize(&existing.root).ok();
            match recorded {
                // Another folder still exists at the recorded location, so this
                // one is a copy. Give it its own history rather than merging two
                // folders into a single activity record.
                Some(recorded) if !same_path(&recorded, root) => {
                    let identity = new_identity(&stored_root);
                    write_identity(root, &identity, true)?;
                    Some(identity)
                }
                // The recorded folder is gone: this is the same folder, moved.
                // The id is kept, so the history follows it.
                _ => {
                    if existing.root != stored_root {
                        let refreshed = WorkspaceIdentity {
                            written_by: existing.written_by.clone(),
                            id: existing.id.clone(),
                            root: stored_root.clone(),
                        };
                        let _ = write_identity(root, &refreshed, true);
                    }
                    Some(WorkspaceIdentity {
                        written_by: existing.written_by,
                        id: existing.id,
                        root: stored_root,
                    })
                }
            }
        }
    }
}

/// Picks the database file for this open.
///
/// Existing databases were keyed by the folder path. When a stable key is in
/// play and its database is missing, the old directory is moved across so the
/// history is adopted rather than abandoned. A copy of the database is taken
/// before that move, because an interrupted move would otherwise cost the user
/// their history with nothing to fall back on. If the move fails for any
/// reason, the legacy database is used for this session and migration is
/// retried next time.
fn resolve_database_path(
    workspaces: &Path,
    stable_key: Option<&str>,
    legacy_key: &str,
) -> Result<PathBuf, String> {
    let legacy_directory = workspaces.join(&legacy_key[..16]);
    let legacy_database = legacy_directory.join(DATABASE_FILE);

    let Some(stable_key) = stable_key else {
        return Ok(legacy_database);
    };
    if stable_key == legacy_key {
        return Ok(workspaces.join(&stable_key[..16]).join(DATABASE_FILE));
    }

    let stable_directory = workspaces.join(&stable_key[..16]);
    let stable_database = stable_directory.join(DATABASE_FILE);
    if !stable_database.exists() && legacy_database.exists() {
        fs::create_dir_all(workspaces).map_err(display_error)?;
        backup_database(&legacy_database);
        // A successful rename is not proof of a usable database, so check the
        // file actually arrived. Both failure modes — the move failing and the
        // move not delivering — fall back to the legacy database rather than
        // failing the open.
        if fs::rename(&legacy_directory, &stable_directory).is_ok() && stable_database.exists() {
            return Ok(stable_database);
        }
        return Ok(legacy_database);
    }
    Ok(stable_database)
}

/// The recoverable copy kept beside a database that is about to be moved.
fn database_backup(database: &Path) -> PathBuf {
    database.with_file_name(format!("{DATABASE_FILE}.bak"))
}

/// Copies the database next to itself so the history survives a move that
/// goes wrong. Failure is deliberately not fatal: a missing backup only means
/// a worse outcome in a case the move already handles, and refusing to open
/// the workspace over it would lose the user far more than it protects.
fn backup_database(database: &Path) -> Option<PathBuf> {
    let backup = database_backup(database);
    match fs::copy(database, &backup) {
        Ok(_) => Some(backup),
        Err(_) => {
            // A half-written backup is worse than none: it would look like a
            // recovery path to a person reaching for one.
            let _ = fs::remove_file(&backup);
            None
        }
    }
}

/// Opens the activity database and checks it is readable before any query
/// relies on it. The database is small and opened once per workspace, so a
/// full integrity check costs nothing and turns a truncated file into an
/// actionable message instead of a confusing SQLite error later on.
fn open_database(path: &Path) -> Result<Connection, String> {
    let database = Connection::open(path).map_err(display_error)?;
    // Anything other than a clean "ok" — including a check that cannot be read
    // at all — means the file cannot be trusted to hold the user's history.
    let verdict = database
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(display_error);
    if verdict.as_deref() != Ok("ok") {
        let backup = database_backup(path);
        let reason = verdict.unwrap_or_else(|error| error);
        drop(database);
        return Err(format!(
            "The activity database for this folder appears to be corrupted ({reason}). \
             Your documents are untouched, but the activity history cannot be read. \
             If the copy kept at {} is present, it can be used to recover the history.",
            backup.display()
        ));
    }
    Ok(database)
}

/// The path as shown to the user. Rust's canonicalize returns Windows
/// verbatim paths (`\\?\C:\...`), which are not what anyone wants to read.
fn display_root(root: &Path) -> String {
    let raw = root.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    raw.into_owned()
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.to_string_lossy();
    let right = right.to_string_lossy();
    if std::env::consts::OS == "windows" {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}

fn new_workspace_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let seed = format!(
        "{}:{}:{}",
        std::process::id(),
        elapsed,
        RandomState::new().build_hasher().finish(),
    );
    content_hash(&seed)
}

fn content_hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            refresh_workspace,
            read_document,
            save_document,
            create_document,
            rename_document,
            query_analytics,
            search_document_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wrava");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_markdown_and_front_matter_from_word_count() {
        let words =
            prose_words("---\ntags: [test]\n---\n# Hello **brave** [world](https://example.com)");
        assert_eq!(words, vec!["hello", "brave", "world"]);
    }

    #[test]
    fn ignores_code_blocks() {
        let words = prose_words("Real words\n\n```rust\nlet hidden = true;\n```");
        assert_eq!(words, vec!["real", "words"]);
    }

    #[test]
    fn establishes_a_baseline_then_records_additions_and_growth() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let database = Connection::open_in_memory().expect("in-memory database");
        initialize_database(&database).expect("database schema");
        let mut workspace = Workspace {
            root: directory.path().to_path_buf(),
            database,
        };

        accept_file(&mut workspace, "draft.md", "# One day", "external")
            .expect("baseline document");
        let baseline = activity_stats(&workspace.database).expect("baseline stats");
        assert_eq!(baseline.today_added, 0);
        assert_eq!(baseline.today_net, 0);

        accept_file(
            &mut workspace,
            "draft.md",
            "# One excellent writing day",
            "wrava",
        )
        .expect("edited document");
        let edited = activity_stats(&workspace.database).expect("edited stats");
        assert_eq!(edited.today_added, 2);
        assert_eq!(edited.today_net, 2);
        assert_eq!(edited.today_documents, 1);
    }

    #[test]
    fn normalizes_and_validates_new_document_names() {
        assert_eq!(document_name("My new draft").unwrap(), "My new draft.md");
        assert_eq!(document_name("Notes.md").unwrap(), "Notes.md");
        assert!(document_name("../outside").is_err());
        assert!(document_name("CON").is_err());
        assert!(document_name("CON.notes.md").is_err());
        assert!(document_name("line\nbreak").is_err());
        assert!(document_name(&"a".repeat(253)).is_err());
        assert_eq!(document_name("Mixed.mD").unwrap(), "Mixed.md");
        assert!(document_name(" ").is_err());
    }

    #[test]
    fn rejects_document_paths_carrying_a_nul_byte() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();

        let error = resolve_document_path(&root, "draft\0.md").expect_err("a NUL byte is refused");

        assert!(
            error.contains("not allowed"),
            "the error must read as a path rejection: {error}"
        );
    }

    #[test]
    fn rejects_absurdly_long_document_paths() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();

        let too_long = format!("{}.md", "a".repeat(MAX_DOCUMENT_PATH_BYTES));
        assert!(
            resolve_document_path(&root, &too_long).is_err(),
            "a path past the bound is refused"
        );

        let generous = format!("{}.md", "a".repeat(MAX_DOCUMENT_PATH_BYTES - 4));
        assert!(
            resolve_document_path(&root, &generous).is_ok(),
            "the bound must stay generous enough for real names"
        );
    }

    #[test]
    fn accepts_names_whose_dots_are_not_a_parent_component() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();
        for name in ["draft..notes.md", "chapter 1..3.md"] {
            fs::write(root.join(name), "# Written").unwrap();

            let resolved = resolve_document_path(&root, name).unwrap();

            assert_eq!(
                resolved,
                root.join(name),
                "'..' inside a name is not traversal"
            );
        }
    }

    #[test]
    fn still_rejects_a_parent_directory_component() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();

        assert!(resolve_document_path(&root, "../escape.md").is_err());
        assert!(resolve_document_path(&root, "notes/../../escape.md").is_err());
    }

    #[test]
    fn keeps_writing_titles_independent_from_file_names() {
        assert_eq!(
            document_name("2026-09-18_reflections-on-discipline").unwrap(),
            "2026-09-18_reflections-on-discipline.md"
        );
        assert_eq!(
            new_document_content("Reflections on Discipline").unwrap(),
            "# Reflections on Discipline\n\n"
        );
        assert_eq!(
            new_document_content("Why: now?").unwrap(),
            "# Why: now?\n\n"
        );
        assert_eq!(
            new_document_content("A *literal* title #").unwrap(),
            "# A \\*literal\\* title \\#\n\n"
        );
        assert!(new_document_content(" ").is_err());
        assert!(new_document_content("First\nSecond").is_err());
    }

    #[test]
    fn creates_independent_title_and_file_without_overwriting_existing_work() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let database = Connection::open_in_memory().expect("in-memory database");
        initialize_database(&database).expect("database schema");
        let mut workspace = Workspace {
            root: fs::canonicalize(directory.path()).unwrap(),
            database,
        };
        let file_name = "2026-09-18_reflections-on-discipline.md";
        let created =
            create_workspace_document(&mut workspace, file_name, "Reflections on Discipline")
                .unwrap();
        assert_eq!(created.document.path, file_name);
        assert_eq!(created.document.content, "# Reflections on Discipline\n\n");
        assert_eq!(
            fs::read_to_string(workspace.root.join(file_name)).unwrap(),
            created.document.content
        );
        assert!(create_workspace_document(&mut workspace, file_name, "Do not overwrite").is_err());
        assert_eq!(
            fs::read_to_string(workspace.root.join(file_name)).unwrap(),
            created.document.content
        );
        assert!(create_workspace_document(&mut workspace, "invalid-title.md", "\n ").is_err());
        assert!(!workspace.root.join("invalid-title.md").exists());
    }

    #[test]
    fn updates_tags_without_changing_other_front_matter() {
        let content = "---\ntitle: Notes\nauthor: Kai\ntags: [old]\n---\n# Notes\n";
        let updated = set_document_tags(content, &["reflection".to_string(), "work".to_string()]);
        assert!(updated.contains("title: Notes"));
        assert!(updated.contains("author: Kai"));
        assert_eq!(
            document_tags(&updated),
            vec!["reflection".to_string(), "work".to_string()]
        );
        assert_eq!(prose_words(&updated), vec!["notes"]);
    }

    #[test]
    fn reads_a_closing_fence_that_ends_the_file_without_a_trailing_newline() {
        // A metadata-only document is the shape that used to lose its tags on both
        // sides of the app: `front_matter` here and `splitMarkdownDocument` in
        // src/documentIdentity.ts both have to agree that the closing `---` at
        // end-of-input really closes the block.
        assert_eq!(front_matter("---\ntags: [essay]\n---"), Some(("tags: [essay]", "")));
        assert_eq!(front_matter("---\ntags: [essay]\n---\n"), Some(("tags: [essay]", "")));
        assert_eq!(front_matter("---\r\ntags: [essay]\r\n---"), Some(("tags: [essay]", "")));
        assert_eq!(front_matter("---\r\ntags: [essay]\r\n---\r\n"), Some(("tags: [essay]", "")));
        assert_eq!(
            document_tags("---\ntags: [essay]\n---"),
            vec!["essay".to_string()]
        );

        // A body may follow either form, and the body keeps its own line ending.
        assert_eq!(
            front_matter("---\ntags: [essay]\n---\nBody.\n"),
            Some(("tags: [essay]", "Body.\n"))
        );
        assert_eq!(
            front_matter("---\r\ntags: [essay]\r\n---\r\nBody.\r\n"),
            Some(("tags: [essay]", "Body.\r\n"))
        );

        // A `---` that only starts a line inside the metadata is not a closing fence.
        assert_eq!(front_matter("---\ntags: [a]\n---x"), None);
        assert_eq!(front_matter("---\n\nJust a rule\n"), None);

        // Retagging edits the existing block rather than prepending a second one.
        let updated = set_document_tags("---\ntitle: Notes\ntags: [old]\n---", &["work".to_string()]);
        assert_eq!(
            updated,
            "---\ntitle: Notes\ntags:\n  - work\n---\n"
        );
        assert_eq!(document_tags(&updated), vec!["work".to_string()]);
        assert!(updated.contains("title: Notes"));
    }

    #[test]
    fn analytics_includes_zero_activity_days_and_document_totals() {
        let database = Connection::open_in_memory().expect("in-memory database");
        initialize_database(&database).expect("database schema");
        let mut workspace = Workspace {
            root: PathBuf::new(),
            database,
        };
        accept_file(&mut workspace, "draft.md", "one two", "external").expect("baseline");
        accept_file(&mut workspace, "draft.md", "one two three", "wrava").expect("edit");

        let analytics = analytics_view(&workspace.database).expect("analytics");
        assert_eq!(analytics.daily.len(), 84);
        assert_eq!(analytics.active_days, 1);
        assert_eq!(analytics.current_word_count, 3);
        assert_eq!(analytics.documents[0].words_added, 1);
    }

    #[test]
    fn display_root_hides_the_windows_verbatim_prefix() {
        assert_eq!(
            display_root(Path::new(r"\\?\C:\Users\kai\Writing")),
            r"C:\Users\kai\Writing"
        );
        assert_eq!(
            display_root(Path::new(r"\\?\UNC\server\share\Writing")),
            r"\\server\share\Writing"
        );
        assert_eq!(display_root(Path::new("/home/kai/writing")), "/home/kai/writing");
    }

    #[test]
    fn records_a_stable_identity_on_first_open() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();

        let identity = ensure_identity(&root).expect("identity written");

        assert!(!identity.id.is_empty());
        assert_eq!(identity.root, display_root(&root));
        assert!(matches!(
            read_identity(&root),
            IdentityFile::Recognised(stored) if stored.id == identity.id
        ));
    }

    #[test]
    fn keeps_the_identity_when_the_folder_is_renamed() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let before = directory.path().join("before");
        fs::create_dir(&before).unwrap();
        let original = ensure_identity(&fs::canonicalize(&before).unwrap())
            .expect("identity written");

        let after = directory.path().join("after");
        fs::rename(&before, &after).unwrap();
        let moved = fs::canonicalize(&after).unwrap();

        let kept = ensure_identity(&moved).expect("identity read");

        assert_eq!(kept.id, original.id, "history must follow the renamed folder");
        assert_eq!(kept.root, display_root(&moved), "the recorded root is refreshed");
    }

    #[test]
    fn issues_a_fresh_identity_for_a_copied_folder() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let original_directory = directory.path().join("original");
        let copy_directory = directory.path().join("copy");
        fs::create_dir(&original_directory).unwrap();
        fs::create_dir(&copy_directory).unwrap();

        let original_root = fs::canonicalize(&original_directory).unwrap();
        let original = ensure_identity(&original_root).expect("identity written");

        // A copied folder carries the same wrava.json, still naming the original.
        let copy_root = fs::canonicalize(&copy_directory).unwrap();
        let carried = serde_json::to_string(&WorkspaceIdentity {
            written_by: original.written_by.clone(),
            id: original.id.clone(),
            root: display_root(&original_root),
        })
        .unwrap();
        fs::write(identity_path(&copy_root), format!("{carried}\n")).unwrap();

        let copy = ensure_identity(&copy_root).expect("identity written");

        assert_ne!(copy.id, original.id, "copies must not share one history");
        assert_eq!(copy.root, display_root(&copy_root));
    }

    #[test]
    fn never_overwrites_an_identity_file_it_did_not_write() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();
        let contents = "{\"project\":\"someone elses file\"}\n";
        fs::write(identity_path(&root), contents).unwrap();

        assert!(ensure_identity(&root).is_none());
        assert_eq!(fs::read_to_string(identity_path(&root)).unwrap(), contents);
    }

    #[test]
    fn ignores_an_identity_shaped_file_that_wrava_did_not_write() {
        // A different program may well use a file called wrava.json. Carrying an
        // `id` is not enough to make it ours: without the marker the folder falls
        // back to the path-derived key, rather than migrating the activity
        // database onto an id somebody else chose.
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();
        let contents = format!(
            "{{\"id\":\"not-ours\",\"root\":{:?},\"project\":\"someone elses file\"}}\n",
            display_root(&root)
        );
        fs::write(identity_path(&root), &contents).unwrap();

        assert!(ensure_identity(&root).is_none());
        assert_eq!(
            fs::read_to_string(identity_path(&root)).unwrap(),
            contents,
            "a foreign file is never rewritten"
        );
    }

    #[test]
    fn writes_the_marker_into_the_identity_it_creates() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let root = fs::canonicalize(directory.path()).unwrap();

        let identity = ensure_identity(&root).expect("identity written");

        assert_eq!(identity.written_by, IDENTITY_MARKER);
        let stored: WorkspaceIdentity =
            serde_json::from_str(&fs::read_to_string(identity_path(&root)).unwrap()).unwrap();
        assert_eq!(stored.written_by, IDENTITY_MARKER);
        assert_eq!(stored.id, identity.id);
    }

    #[test]
    fn moves_the_legacy_database_when_adopting_a_stable_identity() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let workspaces = directory.path().join("workspaces");
        let legacy_key = content_hash(r"\\?\C:\Users\kai\Writing");
        let stable_key = content_hash("a-stable-identity");

        let legacy_directory = workspaces.join(&legacy_key[..16]);
        fs::create_dir_all(&legacy_directory).unwrap();
        fs::write(legacy_directory.join(DATABASE_FILE), "history").unwrap();

        let resolved = resolve_database_path(&workspaces, Some(&stable_key), &legacy_key).unwrap();

        assert_eq!(
            resolved,
            workspaces.join(&stable_key[..16]).join(DATABASE_FILE)
        );
        assert!(resolved.exists(), "the old database is adopted");
        assert!(!legacy_directory.exists(), "the old directory is moved away");
    }

    #[test]
    fn keeps_the_legacy_database_when_no_identity_can_be_written() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let workspaces = directory.path().join("workspaces");
        let legacy_key = content_hash(r"\\?\C:\Users\kai\Writing");

        let resolved = resolve_database_path(&workspaces, None, &legacy_key).unwrap();

        assert_eq!(
            resolved,
            workspaces.join(&legacy_key[..16]).join(DATABASE_FILE)
        );
    }

    #[test]
    fn prefers_the_stable_database_once_it_exists() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let workspaces = directory.path().join("workspaces");
        let legacy_key = content_hash(r"\\?\C:\Users\kai\Writing");
        let stable_key = content_hash("a-stable-identity");

        let legacy_directory = workspaces.join(&legacy_key[..16]);
        let stable_directory = workspaces.join(&stable_key[..16]);
        fs::create_dir_all(&legacy_directory).unwrap();
        fs::create_dir_all(&stable_directory).unwrap();
        fs::write(legacy_directory.join(DATABASE_FILE), "old").unwrap();
        fs::write(stable_directory.join(DATABASE_FILE), "current").unwrap();

        let resolved = resolve_database_path(&workspaces, Some(&stable_key), &legacy_key).unwrap();

        assert_eq!(
            resolved,
            stable_directory.join(DATABASE_FILE),
            "both exist, so the stable one wins"
        );
        assert!(legacy_directory.exists(), "the legacy database is left alone");
    }

    #[test]
    fn keeps_a_backup_of_the_legacy_database_before_moving_it() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let workspaces = directory.path().join("workspaces");
        let legacy_key = content_hash(r"\\?\C:\Users\kai\Writing");
        let stable_key = content_hash("a-stable-identity");
        let legacy_directory = workspaces.join(&legacy_key[..16]);
        let stable_directory = workspaces.join(&stable_key[..16]);

        fs::create_dir_all(&legacy_directory).unwrap();
        fs::write(legacy_directory.join(DATABASE_FILE), "history").unwrap();

        let resolved = resolve_database_path(&workspaces, Some(&stable_key), &legacy_key).unwrap();

        assert_eq!(resolved, stable_directory.join(DATABASE_FILE));
        assert_eq!(
            fs::read_to_string(&resolved).unwrap(),
            "history",
            "the moved database keeps the history it held"
        );
        assert_eq!(
            fs::read_to_string(database_backup(&resolved)).unwrap(),
            "history",
            "the backup is left beside the moved database"
        );
    }

    #[test]
    fn still_opens_the_legacy_database_when_the_move_cannot_complete() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let workspaces = directory.path().join("workspaces");
        let legacy_key = content_hash(r"\\?\C:\Users\kai\Writing");
        let stable_key = content_hash("a-stable-identity");
        let legacy_directory = workspaces.join(&legacy_key[..16]);
        let stable_directory = workspaces.join(&stable_key[..16]);

        fs::create_dir_all(&legacy_directory).unwrap();
        // A non-empty destination cannot be renamed over, so the move fails
        // while the stable database itself is still missing.
        fs::create_dir_all(&stable_directory).unwrap();
        fs::write(stable_directory.join("occupied"), "another app").unwrap();
        fs::write(legacy_directory.join(DATABASE_FILE), "history").unwrap();

        let resolved = resolve_database_path(&workspaces, Some(&stable_key), &legacy_key).unwrap();

        assert_eq!(
            resolved,
            legacy_directory.join(DATABASE_FILE),
            "a failed migration must never cost the user their history"
        );
        assert_eq!(fs::read_to_string(&resolved).unwrap(), "history");
    }

    #[test]
    fn opens_a_healthy_activity_database() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let path = directory.path().join(DATABASE_FILE);
        initialize_database(&Connection::open(&path).unwrap()).expect("database schema");

        let database = open_database(&path).expect("a healthy database opens");

        let tables: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'activity_events'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1, "the database is still usable after the check");
    }

    #[test]
    fn opens_the_brand_new_database_a_first_run_creates() {
        // The integrity check runs on every open, and on a first run the file
        // does not exist yet: Connection::open creates a zero-length file that
        // initialize_database has not touched. A zero-length file is a valid
        // empty SQLite database, so this must pass -- otherwise the check
        // would make every new workspace unopenable.
        let directory = tempfile::tempdir().expect("temporary workspace");
        let path = directory.path().join("nested").join(DATABASE_FILE);
        fs::create_dir_all(path.parent().unwrap()).unwrap();

        let database = open_database(&path).expect("a first run opens an empty database");

        initialize_database(&database).expect("schema applies to the new database");
        assert!(path.exists(), "the new workspace has its database file");
    }

    #[test]
    fn refuses_to_open_a_corrupted_activity_database() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        let path = directory.path().join(DATABASE_FILE);
        fs::write(&path, "this was never a database").unwrap();

        let error = open_database(&path).expect_err("a corrupt database must be refused");

        assert!(
            error.contains("corrupted"),
            "the error must say what is wrong: {error}"
        );
        assert!(
            error.contains(&format!("{DATABASE_FILE}.bak")),
            "the error must point at the recovery copy: {error}"
        );

        let backup = database_backup(&path);
        fs::write(&backup, "history").unwrap();
        let with_backup = open_database(&path).expect_err("a corrupt database must be refused");
        assert!(
            with_backup.contains(&backup.display().to_string()),
            "the recovery copy must be named exactly: {with_backup}"
        );
    }

    /// Builds a workspace holding one document per named case, so the content
    /// search is exercised against a real folder rather than a stubbed reader.
    fn workspace_with(search_cases: &[(&str, &str)]) -> tempfile::TempDir {
        let directory = tempfile::tempdir().expect("temporary workspace");
        for (relative, content) in search_cases {
            let path = directory.path().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        directory
    }

    #[test]
    fn finds_a_document_by_what_it_says_rather_than_what_it_is_called() {
        let directory = workspace_with(&[
            (
                "2026-09-16 Book notes.md",
                "---\ntags: [reading]\n---\n# Book notes\n\nThe harbourmaster keeps her own record.\n",
            ),
            (
                "2026-09-15 Novel outline.md",
                "---\ntags: [fiction]\n---\n# Novel outline\n\nA quiet coastal town watches its tides.\n",
            ),
        ]);
        let root = fs::canonicalize(directory.path()).unwrap();

        // "harbourmaster" is in one body and in no file name.
        assert_eq!(
            search_content(&root, "harbourmaster").unwrap(),
            vec!["2026-09-16 Book notes.md"]
        );
        // Sub-folders come back in the same relative form the sidebar already holds.
        assert_eq!(
            search_content(&root, "tides").unwrap(),
            vec!["2026-09-15 Novel outline.md"]
        );
    }

    #[test]
    fn searches_document_bodies_case_insensitively() {
        let directory = workspace_with(&[(
            "notes.md",
            "---\ntags: [reading]\n---\n# Notes\n\nThe Harbourmaster keeps her own record.\n",
        )]);
        let root = fs::canonicalize(directory.path()).unwrap();

        assert_eq!(search_content(&root, "HARBOURMASTER").unwrap(), vec!["notes.md"]);
        assert_eq!(
            search_content(&root, "  HarbourMaster  ").unwrap(),
            vec!["notes.md"],
            "the query is trimmed like every other search in the app"
        );
    }

    #[test]
    fn never_finds_a_document_by_its_front_matter_metadata() {
        let directory = workspace_with(&[
            (
                "harbourmaster.md",
                "---\ntags: [tidemaster]\ntitle: Notes\n---\n# Notes\n\nNothing to see.\n",
            ),
            ("plain.md", "---\ntags: [reading]\n---\n# Plain\n\nNothing to see.\n"),
        ]);
        let root = fs::canonicalize(directory.path()).unwrap();

        // Both tags are metadata. Neither document may be found by them.
        assert!(
            search_content(&root, "tidemaster").unwrap().is_empty(),
            "a tags: block is not something the writer wrote"
        );
        assert!(search_content(&root, "title").unwrap().is_empty());
        assert!(search_content(&root, "---").unwrap().is_empty());
        // The document that does say it in its body is still found.
        assert_eq!(
            search_content(&root, "nothing").unwrap(),
            vec!["harbourmaster.md", "plain.md"]
        );
    }

    #[test]
    fn honours_the_visibility_rules_the_folder_listing_uses() {
        let directory = workspace_with(&[
            ("visible.md", "# Visible\n\nA recorded tide.\n"),
            (".hidden.md", "# Hidden\n\nA recorded tide.\n"),
            ("node_modules/package.md", "# Installed\n\nA recorded tide.\n"),
            (".git/objects/note.md", "# Object\n\nA recorded tide.\n"),
            ("notes.txt", "A recorded tide, but not a document.\n"),
        ]);
        let root = fs::canonicalize(directory.path()).unwrap();

        assert_eq!(
            search_content(&root, "recorded").unwrap(),
            vec!["visible.md"],
            "the same dotfiles, node_modules and non-Markdown files are skipped"
        );
        assert_eq!(
            markdown_files(&root).unwrap(),
            vec!["visible.md"],
            "searching cannot widen what the sidebar is allowed to list"
        );
    }

    #[test]
    fn skips_a_query_too_short_to_be_worth_the_walk() {
        let directory = workspace_with(&[("notes.md", "# Notes\n\nTides.\n")]);
        let root = fs::canonicalize(directory.path()).unwrap();

        assert!(search_content(&root, "").unwrap().is_empty());
        assert!(search_content(&root, "   ").unwrap().is_empty());
        assert!(search_content(&root, "t").unwrap().is_empty());
        assert_eq!(
            search_content(&root, "ti").unwrap(),
            vec!["notes.md"],
            "the floor is the same on both sides of it"
        );
    }

    #[test]
    fn refuses_an_absurdly_long_search_query() {
        let directory = workspace_with(&[("notes.md", "# Notes\n")]);
        let root = fs::canonicalize(directory.path()).unwrap();

        assert!(search_content(&root, &"a".repeat(MAX_CONTENT_SEARCH_CHARS + 1)).is_err());
        assert!(search_content(
            &root,
            &"a".repeat(MAX_CONTENT_SEARCH_CHARS)
        )
        .is_ok());
    }

    #[test]
    fn leaves_file_name_matching_to_the_sidebar() {
        let directory = workspace_with(&[(
            "harbourmaster.md",
            "---\ntags: [reading]\n---\n# Notes\n\nNothing about tides.\n",
        )]);
        let root = fs::canonicalize(directory.path()).unwrap();

        assert!(
            search_content(&root, "harbourmaster").unwrap().is_empty(),
            "the name is already filtered in the frontend, where every path is held"
        );
    }

    #[test]
    fn keeps_searching_past_a_document_it_cannot_read() {
        let directory = workspace_with(&[
            ("broken.md", "# Broken\n\nA recorded tide.\n"),
            ("readable.md", "# Readable\n\nA recorded tide.\n"),
        ]);
        let root = fs::canonicalize(directory.path()).unwrap();
        // A file the walker lists but cannot decode as text: not every `.md` on
        // disk is a document Wrava or anyone else can read as one.
        fs::write(root.join("broken.md"), [0xff, 0xfe, 0x00]).unwrap();

        assert_eq!(search_content(&root, "recorded").unwrap(), vec!["readable.md"]);
    }

    #[test]
    fn agrees_with_the_frontend_splitter_about_a_document_with_no_metadata() {
        // `splitMarkdownDocument` in src/documentIdentity.ts leaves a document
        // with no front matter whole, so a body that merely opens with a rule
        // is still searchable. The two sides have documented differences; this
        // is the case they must not disagree on.
        let directory = workspace_with(&[("rule.md", "---\n\nJust a rule, then the tide.\n")]);
        let root = fs::canonicalize(directory.path()).unwrap();

        assert_eq!(
            searchable_body("---\n\nJust a rule, then the tide.\n"),
            "---\n\nJust a rule, then the tide.\n"
        );
        assert_eq!(search_content(&root, "tide").unwrap(), vec!["rule.md"]);
    }
}
