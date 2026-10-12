import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsCsvFilename,
  analyticsExportBaseName,
  analyticsJsonFilename,
  analyticsToCsv,
  analyticsToJson,
  csvEscapeField,
  tagsToCsvCell,
} from "../src/analyticsExport.ts";
import type { AnalyticsView } from "../src/types.ts";

const view: AnalyticsView = {
  daily: [
    { date: "2026-10-10", wordsAdded: 120, wordsDeleted: 10, netChange: 110, activeDocuments: 2 },
    { date: "2026-10-11", wordsAdded: 0, wordsDeleted: 25, netChange: -25, activeDocuments: 0 },
  ],
  documents: [
    {
      path: "drafts\\essay.md",
      currentWordCount: 900,
      wordsAdded: 300,
      wordsDeleted: 20,
      netChange: 280,
      tags: ["work", "urgent"],
    },
    {
      path: "notes.md",
      currentWordCount: 40,
      wordsAdded: 0,
      wordsDeleted: 0,
      netChange: 0,
      tags: [],
    },
  ],
  activeDays: 1,
  activeDocuments: 2,
  currentWordCount: 940,
  tags: [
    { tag: "work", documents: 1, wordsAdded: 300, wordsDeleted: 20, netChange: 280 },
    { tag: "urgent", documents: 1, wordsAdded: 300, wordsDeleted: 20, netChange: 280 },
  ],
  bigrams: [
    { phrase: "deep work", count: 12 },
    { phrase: "morning, evening", count: 7 },
  ],
};

const empty: AnalyticsView = {
  daily: [],
  documents: [],
  activeDays: 0,
  activeDocuments: 0,
  currentWordCount: 0,
  tags: [],
  bigrams: [],
};

// Minimal RFC 4180 reader so the tests assert on parsed records rather than on
// substrings. Handles quoted fields, doubled quotes and record-spanning newlines.
function parseCsv(source: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { record.push(field); field = ""; continue; }
    if (character === "\r" && source[index + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      index += 1;
      continue;
    }
    field += character;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }
  return records;
}

function sections(csv: string) {
  const parsed = parseCsv(csv);
  const found = new Map<string, { header: string[]; rows: string[][] }>();
  let current: { title: string; header: string[]; rows: string[][] } | null = null;
  for (const fields of parsed) {
    if (fields[0]?.startsWith("# ")) {
      current = { title: fields[0].slice(2), header: [], rows: [] };
      found.set(current.title, current);
      continue;
    }
    if (!current) continue;
    if (fields.length === 1 && fields[0] === "") continue;
    if (!current.header.length) current.header = fields;
    else current.rows.push(fields);
  }
  return found;
}

test("every section carries its own header row", () => {
  const found = sections(analyticsToCsv(view));
  assert.deepEqual([...found.keys()], ["Summary", "Daily activity", "Documents", "Tags", "Bigrams"]);
  assert.deepEqual(found.get("Daily activity")?.header,
    ["date", "wordsAdded", "wordsDeleted", "netChange", "activeDocuments"]);
  assert.deepEqual(found.get("Documents")?.header,
    ["path", "currentWordCount", "wordsAdded", "wordsDeleted", "netChange", "tags"]);
  assert.deepEqual(found.get("Tags")?.header,
    ["tag", "documents", "wordsAdded", "wordsDeleted", "netChange"]);
  assert.deepEqual(found.get("Bigrams")?.header, ["phrase", "count"]);
  assert.deepEqual(found.get("Summary")?.header, ["metric", "value"]);
});

test("each dataset round-trips every field it owns", () => {
  const found = sections(analyticsToCsv(view));
  assert.deepEqual(found.get("Daily activity")?.rows, [
    ["2026-10-10", "120", "10", "110", "2"],
    ["2026-10-11", "0", "25", "-25", "0"],
  ]);
  assert.deepEqual(found.get("Documents")?.rows, [
    ["drafts\\essay.md", "900", "300", "20", "280", "work;urgent"],
    ["notes.md", "40", "0", "0", "0", ""],
  ]);
  assert.deepEqual(found.get("Tags")?.rows, [
    ["work", "1", "300", "20", "280"],
    ["urgent", "1", "300", "20", "280"],
  ]);
  assert.deepEqual(found.get("Bigrams")?.rows, [["deep work", "12"], ["morning, evening", "7"]]);
  assert.deepEqual(found.get("Summary")?.rows, [
    ["activeDays", "1"],
    ["activeDocuments", "2"],
    ["currentWordCount", "940"],
    ["dailyEntries", "2"],
    ["documentEntries", "2"],
    ["tagEntries", "2"],
    ["phraseEntries", "2"],
    ["wordsAdded", "120"],
    ["wordsDeleted", "35"],
    ["netChange", "85"],
  ]);
});

test("fields escape commas, quotes and newlines per RFC 4180", () => {
  assert.equal(csvEscapeField("plain"), "plain");
  assert.equal(csvEscapeField(42), "42");
  assert.equal(csvEscapeField("a,b"), "\"a,b\"");
  assert.equal(csvEscapeField("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvEscapeField("line one\nline two"), "\"line one\nline two\"");
  assert.equal(csvEscapeField("carriage\r\nreturn"), "\"carriage\r\nreturn\"");
  assert.equal(csvEscapeField("both\r\n"), "\"both\r\n\"");
  assert.equal(csvEscapeField(""), "");

  const csv = analyticsToCsv({
    ...view,
    documents: [{
      path: 'odd, "quoted".md',
      currentWordCount: 1,
      wordsAdded: 2,
      wordsDeleted: 3,
      netChange: -1,
      tags: [],
    }],
    bigrams: [{ phrase: 'first line\nsecond "line"', count: 3 }],
  });
  assert.match(csv, /"odd, ""quoted"".md",1,2,3,-1,/);
  const found = sections(csv);
  assert.deepEqual(found.get("Documents")?.rows[0][0], 'odd, "quoted".md');
  assert.deepEqual(found.get("Bigrams")?.rows[0][0], 'first line\nsecond "line"');
});

test("windows paths keep their backslashes unescaped", () => {
  const csv = analyticsToCsv(view);
  assert.match(csv, /drafts\\essay\.md,900,300,20,280,work;urgent/);
  assert.equal(csvEscapeField("C:\\Writing\\drafts\\essay.md"), "C:\\Writing\\drafts\\essay.md");
  assert.equal(sections(csv).get("Documents")?.rows[0][0], "drafts\\essay.md");
});

test("non-ASCII text survives a CSV round-trip", () => {
  const unicode: AnalyticsView = {
    ...view,
    documents: [{
      path: "笔记/日本語/essay.md",
      currentWordCount: 5,
      wordsAdded: 6,
      wordsDeleted: 7,
      netChange: -1,
      tags: ["写作", "ué"],
    }],
    bigrams: [{ phrase: "日yo 記 📓✨, done", count: 2 }],
    tags: [{ tag: "写作", documents: 1, wordsAdded: 6, wordsDeleted: 7, netChange: -1 }],
  };
  const csv = analyticsToCsv(unicode);
  const found = sections(csv);
  assert.equal(found.get("Documents")?.rows[0][0], "笔记/日本語/essay.md");
  assert.equal(found.get("Documents")?.rows[0][5], "写作;ué");
  assert.equal(found.get("Tags")?.rows[0][0], "写作");
  assert.equal(found.get("Bigrams")?.rows[0][0], "日yo 記 📓✨, done");
  assert.deepEqual(JSON.parse(analyticsToJson(unicode)), unicode);
});

test("tag arrays use a reversible semicolon join", () => {
  assert.equal(tagsToCsvCell([]), "");
  assert.equal(tagsToCsvCell(["work"]), "work");
  assert.equal(tagsToCsvCell(["work", "urgent", "deep work"]), "work;urgent;deep work");
  assert.equal(tagsToCsvCell(["a;b"]), "a;;b");
  assert.equal(tagsToCsvCell(["semi;colon", "plain"]), "semi;;colon;plain");

  const splitTagCell = (cell: string) => {
    const tags: string[] = [];
    let current = "";
    for (let index = 0; index < cell.length; index += 1) {
      if (cell[index] === ";" && cell[index + 1] === ";") { current += ";"; index += 1; }
      else if (cell[index] === ";") { tags.push(current); current = ""; }
      else current += cell[index];
    }
    tags.push(current);
    return tags;
  };
  for (const original of [["a;b", "c"], [";"], ["trailing;"], [";leading", "x;"], ["plain"]]) {
    assert.deepEqual(splitTagCell(tagsToCsvCell(original)), original);
  }
});

test("an empty workspace still produces a valid file, not undefined", () => {
  const csv = analyticsToCsv(empty);
  assert.equal(typeof csv, "string");
  assert.ok(csv.length > 0);
  assert.match(csv, /# Summary\r\nmetric,value\r\n/);
  assert.match(csv, /# Daily activity\r\ndate,wordsAdded,wordsDeleted,netChange,activeDocuments\r\n/);
  assert.match(csv, /# Documents\r\npath,currentWordCount,wordsAdded,wordsDeleted,netChange,tags\r\n/);
  assert.match(csv, /# Tags\r\ntag,documents,wordsAdded,wordsDeleted,netChange\r\n/);
  assert.match(csv, /# Bigrams\r\nphrase,count\r\n/);
  assert.ok(csv.endsWith("\r\n"));
  const found = sections(csv);
  assert.equal(found.size, 5);
  for (const title of ["Daily activity", "Documents", "Tags", "Bigrams"]) {
    assert.deepEqual(found.get(title)?.rows, [], `${title} keeps its header and no data rows`);
  }
  assert.deepEqual(found.get("Summary")?.rows, [
    ["activeDays", "0"], ["activeDocuments", "0"], ["currentWordCount", "0"],
    ["dailyEntries", "0"], ["documentEntries", "0"], ["tagEntries", "0"], ["phraseEntries", "0"],
    ["wordsAdded", "0"], ["wordsDeleted", "0"], ["netChange", "0"],
  ]);
  assert.doesNotThrow(() => JSON.parse(analyticsToJson(empty)));
});

test("sections are separated by a blank line and records use CRLF", () => {
  const csv = analyticsToCsv(view);
  assert.ok(csv.startsWith("# Summary\r\n"));
  assert.ok(csv.includes("netChange,85\r\n\r\n# Daily activity\r\n"));
  assert.ok(csv.endsWith("\"morning, evening\",7\r\n"));
  assert.equal(csv.includes("\n\n"), false);
  assert.equal(csv.replaceAll("\r\n", "").includes("\n"), false);
});

test("JSON export parses back to an object deep-equal to the input", () => {
  const json = analyticsToJson(view);
  assert.deepEqual(JSON.parse(json), view);
  assert.deepEqual(JSON.parse(analyticsToJson(empty)), empty);
  assert.equal(json.includes("\n  \"daily\": ["), true, "output is pretty printed");
  assert.equal(view.daily.length, 2, "the input is not mutated");
});

test("filenames use the local date convention shared with documentIdentity", () => {
  assert.equal(analyticsExportBaseName(new Date(2026, 0, 5)), "wrava-analytics-2026-01-05");
  assert.equal(analyticsCsvFilename(new Date(2026, 8, 16)), "wrava-analytics-2026-09-16.csv");
  assert.equal(analyticsJsonFilename(new Date(2026, 11, 31)), "wrava-analytics-2026-12-31.json");
  assert.match(analyticsCsvFilename(), /^wrava-analytics-\d{4}-\d{2}-\d{2}\.csv$/);
});