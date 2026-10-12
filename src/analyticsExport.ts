// Serialization for the analytics dashboard's CSV and JSON exports.
//
// Everything here is pure: no DOM, no `window`, no `document`, no clock read
// unless a caller passes one in. That is deliberate — the project's suite is
// `node --test` over plain modules, so any serialization living inside the React
// component would be untestable by construction. AnalyticsPage.tsx owns the DOM
// side (blob, object URL, clipboard); this file owns the bytes.
//
// CSV SHAPE
// ---------
// The four datasets have different columns, so the export is one file of four
// stacked sections rather than one wide table. Each section is:
//
//     # <Section title>
//     <header row>
//     <data row>...
//     <blank line>
//
// Rules, all RFC 4180:
//   * Records are terminated with CRLF, which is what the RFC specifies and what
//     Excel expects on Windows. The file therefore ends with a CRLF.
//   * A field is wrapped in double quotes when it contains a comma, a double
//     quote, CR or LF, and embedded quotes are doubled (`"` -> `""`). Fields
//     without those characters are emitted bare.
//   * Backslashes are NOT escaped. `C:\Writing\drafts\essay.md` is a single
//     unquoted field; CSV has no escape character, and doubling backslashes
//     would corrupt Windows paths on import.
//   * An embedded newline is legal inside a quoted field, so it is emitted as-is
//     rather than folded. One value can therefore span several physical lines.
//   * `#` title lines and the blank lines between them are not valid data
//     records. Consumers that want a single flat table should read the `#
//     <title>` markers and skip them; every section's header row is present
//     even when its dataset is empty, so an empty workspace still yields a
//     well-formed file rather than an empty one.
//
// TAGS IN A CELL
// --------------
// `DocumentActivity.tags` is a string array in a single-cell field. Tags are
// joined with `;` (the app's own tag syntax is comma-separated, so `;` is free,
// and it keeps the cell readable without quoting). An embedded `;` inside a
// single tag is doubled (`;` -> `;;`), mirroring RFC 4180's doubling convention
// for quotes, so the join is unambiguously reversible. An empty array is an
// empty cell. The CSV writer's own quoting still applies on top of this, so a
// tag containing a comma is quoted like any other field.

import type { AnalyticsView } from "./types";
import { localDatePrefix } from "./documentIdentity.ts";

export const CSV_RECORD_END = "\r\n";
export const CSV_SECTION_PREFIX = "# ";
export const CSV_TAG_SEPARATOR = ";";

export type CsvValue = string | number;

export type CsvSection = {
  title: string;
  columns: string[];
  rows: CsvValue[][];
};

export function csvEscapeField(value: CsvValue): string {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvEscapeField).join(",");
}

export function tagsToCsvCell(tags: string[]): string {
  return (tags ?? []).map((tag) => String(tag ?? "").replace(/;/g, ";;")).join(CSV_TAG_SEPARATOR);
}

export function analyticsCsvSections(analytics: AnalyticsView): CsvSection[] {
  const daily = analytics.daily ?? [];
  const documents = analytics.documents ?? [];
  const tags = analytics.tags ?? [];
  const bigrams = analytics.bigrams ?? [];
  return [
    {
      title: "Summary",
      columns: ["metric", "value"],
      rows: [
        ["activeDays", analytics.activeDays],
        ["activeDocuments", analytics.activeDocuments],
        ["currentWordCount", analytics.currentWordCount],
        ["dailyEntries", daily.length],
        ["documentEntries", documents.length],
        ["tagEntries", tags.length],
        ["phraseEntries", bigrams.length],
        ["wordsAdded", daily.reduce((sum, day) => sum + day.wordsAdded, 0)],
        ["wordsDeleted", daily.reduce((sum, day) => sum + day.wordsDeleted, 0)],
        ["netChange", daily.reduce((sum, day) => sum + day.netChange, 0)],
      ],
    },
    {
      title: "Daily activity",
      columns: ["date", "wordsAdded", "wordsDeleted", "netChange", "activeDocuments"],
      rows: daily.map((day) => [
        day.date,
        day.wordsAdded,
        day.wordsDeleted,
        day.netChange,
        day.activeDocuments,
      ]),
    },
    {
      title: "Documents",
      columns: ["path", "currentWordCount", "wordsAdded", "wordsDeleted", "netChange", "tags"],
      rows: documents.map((document) => [
        document.path,
        document.currentWordCount,
        document.wordsAdded,
        document.wordsDeleted,
        document.netChange,
        tagsToCsvCell(document.tags),
      ]),
    },
    {
      title: "Tags",
      columns: ["tag", "documents", "wordsAdded", "wordsDeleted", "netChange"],
      rows: tags.map((tag) => [
        tag.tag,
        tag.documents,
        tag.wordsAdded,
        tag.wordsDeleted,
        tag.netChange,
      ]),
    },
    {
      title: "Bigrams",
      columns: ["phrase", "count"],
      rows: bigrams.map((bigram) => [bigram.phrase, bigram.count]),
    },
  ];
}

export function analyticsToCsv(analytics: AnalyticsView): string {
  return analyticsCsvSections(analytics)
    .map((section) => [
      `${CSV_SECTION_PREFIX}${section.title}`,
      csvRow(section.columns),
      ...section.rows.map(csvRow),
    ].join(CSV_RECORD_END) + CSV_RECORD_END)
    .join(CSV_RECORD_END);
}

// Plain, pretty-printed view of the analytics object. `JSON.parse` of the result
// is deep-equal to the input, so this is the lossless half of the export; the CSV
// is the spreadsheet-friendly one.
export function analyticsToJson(analytics: AnalyticsView): string {
  return JSON.stringify(analytics, null, 2);
}

export function analyticsExportBaseName(date: Date = new Date()): string {
  return `wrava-analytics-${localDatePrefix(date)}`;
}

export function analyticsCsvFilename(date: Date = new Date()): string {
  return `${analyticsExportBaseName(date)}.csv`;
}

export function analyticsJsonFilename(date: Date = new Date()): string {
  return `${analyticsExportBaseName(date)}.json`;
}