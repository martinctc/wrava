// Sidebar document search. The input matches file names directly; matching what
// the user WROTE needs a read of every document in the workspace, so that half
// lives in the backends (Rust core and demo backend) and only the decision of
// what to display lives here. Pure functions, no DOM and no I/O, so the merge
// is testable on its own.

/**
 * Shortest query that earns a walk of the workspace.
 *
 * One character matches most of a large folder, so scanning for it costs the
 * same as scanning for a whole phrase and finds little the file-name filter was
 * not already showing. Both backends apply this floor; see `shouldSearchContent`.
 */
export const MIN_CONTENT_SEARCH_CHARS = 2;

/**
 * How long the input rests before the workspace is searched for content.
 *
 * The autosave timer is two seconds because a write has consequences. This one
 * only reads, but it walks every document on disk, so waiting out a burst of
 * keystrokes is the difference between one scan per phrase and one scan per
 * letter.
 */
export const DOCUMENT_SEARCH_DEBOUNCE_MS = 200;

/** Case-insensitive, trimmed — the single normalisation the sidebar search uses. */
export function normalizeSearchQuery(query: string): string {
  return query.toLowerCase().trim();
}

/**
 * Whether a query is long enough to be worth walking the workspace for.
 *
 * Below this length the sidebar still filters by file name — which costs
 * nothing — and simply offers no content matches. Both backends apply the same
 * floor so the demo and the desktop app cannot disagree about what a one
 * letter query does.
 */
export function shouldSearchContent(query: string): boolean {
  return query.trim().length >= MIN_CONTENT_SEARCH_CHARS;
}

/**
 * The documents the sidebar shows, in the order it was given.
 *
 * A document is listed when its name contains the query, when the backend found
 * the query inside it, or both. Content matches are intersected with `paths`:
 * the backends return the same relative paths `workspace.files` carries, but a
 * document renamed or deleted while a search was in flight must not leave a
 * ghost entry behind. An empty query restores the unfiltered list.
 */
export function filterDocuments(
  paths: readonly string[],
  query: string,
  contentMatches: readonly string[] = [],
): string[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [...paths];
  const matches = new Set(contentMatches);
  return paths.filter(
    (path) => path.toLowerCase().includes(normalized) || matches.has(path),
  );
}
