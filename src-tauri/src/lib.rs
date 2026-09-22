use atomicwrites::{AllowOverwrite, AtomicFile, DisallowOverwrite};
use chrono::{Datelike, Local, NaiveDate};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
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
struct AnalyticsView {
    daily: Vec<DailyActivity>,
    documents: Vec<DocumentActivity>,
    active_days: usize,
    active_documents: usize,
    current_word_count: i64,
    tags: Vec<TagActivity>,
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

#[tauri::command]
fn open_workspace(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<WorkspaceView, String> {
    let root = fs::canonicalize(&path).map_err(display_error)?;
    if !root.is_dir() {
        return Err("The selected workspace is not a folder.".into());
    }

    let workspace_key = content_hash(root.to_string_lossy().as_ref());
    let database_path = app
        .path()
        .app_local_data_dir()
        .map_err(display_error)?
        .join("workspaces")
        .join(&workspace_key[..16])
        .join("wrava.sqlite3");
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent).map_err(display_error)?;
    }

    let database = Connection::open(database_path).map_err(display_error)?;
    initialize_database(&database)?;
    let mut workspace = Workspace { root, database };
    reconcile(&mut workspace)?;
    let view = workspace_view(&workspace)?;
    *state.workspace.lock().map_err(display_error)? = Some(workspace);
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
        root: workspace.root.to_string_lossy().into_owned(),
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
    for document in &mut documents {
        let content: String = database
            .query_row(
                "SELECT content FROM documents WHERE path = ?1",
                [&document.path],
                |row| row.get(0),
            )
            .map_err(display_error)?;
        document.tags = document_tags(&content);
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

    Ok(AnalyticsView {
        daily,
        documents,
        active_days,
        active_documents,
        current_word_count,
        tags: tags.into_values().collect(),
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
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    files.sort_by_key(|path| path.to_lowercase());
    Ok(files)
}

fn visible_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.') && name != "node_modules"
}

fn resolve_document_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
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
    let closing = format!("{newline}---{newline}");
    let closing_index = content[opening_length..].find(&closing)? + opening_length;
    let body_start = closing_index + closing.len();
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
            query_analytics
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
}
