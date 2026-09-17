// In-browser demo backend used when Wrava is not running inside Tauri
// (i.e. the GitHub Pages demo). It reimplements just enough of the Rust
// core's behaviour - word counting, front-matter tags, and activity
// rollups - to make the demo feel real, entirely in memory. Nothing here
// is persisted: a page reload resets to the seeded starting state.
import type {
  ActivityStats,
  AnalyticsView,
  DailyActivity,
  DocumentActivity,
  DocumentResult,
  DocumentView,
  TagActivity,
  WorkspaceView,
} from "./types";

export const DEMO_WORKSPACE_ROOT = "Demo workspace (in your browser)";

export const DEMO_BANNER =
  "You're viewing a live demo. Nothing you type is saved, and this data resets when you reload the page.";

type DemoDocument = {
  path: string;
  content: string;
};

type DemoDayHistory = {
  date: string;
  wordsAdded: number;
  wordsDeleted: number;
  activeDocuments: number;
};

const HISTORY_DAYS = 84;

function frontMatter(content: string): { tags: string[]; body: string } {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)([\s\S]*)$/);
  if (!match) {
    return { tags: [], body: content };
  }
  const [, , yaml, , body] = match;
  const tagLine = yaml.split(/\r?\n/).find((line) => line.trim().startsWith("tags:"));
  if (!tagLine) {
    return { tags: [], body };
  }
  const value = tagLine.slice(tagLine.indexOf(":") + 1).trim();
  const tags = value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return { tags, body };
}

function withTags(content: string, tags: string[]): string {
  const { body } = frontMatter(content);
  const cleanBody = body.replace(/^\r?\n/, "");
  if (tags.length === 0) {
    return cleanBody;
  }
  return `---\ntags: [${tags.join(", ")}]\n---\n${cleanBody}`;
}

// Approximate word count: strips Markdown emphasis/heading markers, then
// splits on whitespace. Good enough for demo purposes; the real app uses a
// proper Markdown parser (pulldown-cmark) for exact counts.
function countWords(content: string): number {
  const { body } = frontMatter(content);
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~[\]()-]/g, " ")
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(count: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - count);
  return date;
}

// Deterministic pseudo-random generator (mulberry32) so the seeded demo
// history looks the same on every load, rather than reshuffling on every
// visit.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seededDocuments: DemoDocument[] = [
  {
    path: "2026-09-10 Morning pages.md",
    content:
      "---\ntags: [journal]\n---\n# Morning pages\n\nA short, unfiltered warm-up before the real writing starts. The goal is\nvolume, not quality.\n",
  },
  {
    path: "2026-09-12 Essay on slow productivity.md",
    content:
      "---\ntags: [essay, productivity]\n---\n# Essay on slow productivity\n\nThere is a case to be made that writing daily, even briefly, compounds in a\nway that occasional long sessions never quite match. The habit itself\nbecomes the asset.\n\n## Why small sessions work\n\n- Momentum survives the gap between sessions\n- Editing pressure stays low when the draft is fresh\n- Ideas surface between sessions, not just during them\n\nKeeping the practice **visible** turns it from an intention into a record.\n\nTry editing this paragraph. Wrava will count the words you add and remove,\nright here in your browser.\n",
  },
  {
    path: "2026-09-15 Novel outline.md",
    content:
      "---\ntags: [fiction, outline]\n---\n# Novel outline\n\n## Act one\n\nA quiet coastal town notices its tides have started arriving early.\n\n## Act two\n\nA harbourmaster's daughter starts keeping her own record, against her\nfather's wishes.\n\n## Act three\n\nThe town has to decide whether to trust a measurement nobody asked for.\n",
  },
  {
    path: "2026-09-16 Book notes.md",
    content:
      "---\ntags: [reading, notes]\n---\n# Book notes\n\nNotes on pacing, structure, and the difference between a habit tracker and\na practice log.\n",
  },
];

function buildSeededHistory(): DemoDayHistory[] {
  const random = mulberry32(20260917);
  const history: DemoDayHistory[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 1; i--) {
    const active = random() > 0.32;
    const wordsAdded = active ? Math.round(60 + random() * 560) : 0;
    const wordsDeleted = active ? Math.round(random() * wordsAdded * 0.3) : 0;
    history.push({
      date: isoDate(daysAgo(i)),
      wordsAdded,
      wordsDeleted,
      activeDocuments: active ? 1 + Math.round(random() * 2) : 0,
    });
  }
  return history;
}

const seededHistory = buildSeededHistory();

const seededPerDocument = new Map<string, { wordsAdded: number; wordsDeleted: number }>([
  ["2026-09-10 Morning pages.md", { wordsAdded: 540, wordsDeleted: 60 }],
  ["2026-09-12 Essay on slow productivity.md", { wordsAdded: 2260, wordsDeleted: 480 }],
  ["2026-09-15 Novel outline.md", { wordsAdded: 5100, wordsDeleted: 1140 }],
  ["2026-09-16 Book notes.md", { wordsAdded: 1700, wordsDeleted: 200 }],
]);

class DemoStore {
  documents = new Map<string, DemoDocument>(seededDocuments.map((doc) => [doc.path, doc]));
  baselineWordCounts = new Map<string, number>(
    seededDocuments.map((doc) => [doc.path, countWords(doc.content)]),
  );
  // Session-only deltas layered on top of the seeded history, so edits made
  // during this visit show up immediately in "today"'s activity and in the
  // trend chart's final day.
  sessionWordsAdded = 0;
  sessionWordsDeleted = 0;
  sessionActiveDocuments = new Set<string>();

  files(): string[] {
    return [...this.documents.keys()].sort();
  }

  stats(): ActivityStats {
    const today = this.sessionWordsAdded;
    const todayNet = this.sessionWordsAdded - this.sessionWordsDeleted;
    const recentWeek = seededHistory.slice(-6);
    const recentMonth = seededHistory.slice(-29);
    const recentYear = seededHistory;

    const sum = (days: DemoDayHistory[], key: "wordsAdded" | "wordsDeleted") =>
      days.reduce((total, day) => total + day[key], 0);

    const weekAdded = sum(recentWeek, "wordsAdded") + today;
    const monthAdded = sum(recentMonth, "wordsAdded") + today;
    const yearAdded = sum(recentYear, "wordsAdded") + today;
    const weekDeleted = sum(recentWeek, "wordsDeleted") + this.sessionWordsDeleted;
    const monthDeleted = sum(recentMonth, "wordsDeleted") + this.sessionWordsDeleted;
    const yearDeleted = sum(recentYear, "wordsDeleted") + this.sessionWordsDeleted;

    const activeCount = (days: DemoDayHistory[]) =>
      new Set(days.filter((day) => day.wordsAdded > 0).map((day) => day.date)).size
      + (this.sessionActiveDocuments.size > 0 ? 1 : 0);

    return {
      todayAdded: today,
      weekAdded,
      monthAdded,
      yearAdded,
      todayNet,
      weekNet: weekAdded - weekDeleted,
      monthNet: monthAdded - monthDeleted,
      yearNet: yearAdded - yearDeleted,
      todayDocuments: this.sessionActiveDocuments.size,
      weekDocuments: Math.max(this.sessionActiveDocuments.size, activeCount(recentWeek)),
      monthDocuments: Math.max(this.sessionActiveDocuments.size, activeCount(recentMonth)),
      yearDocuments: Math.max(this.sessionActiveDocuments.size, activeCount(recentYear)),
    };
  }

  workspace(): WorkspaceView {
    return { root: DEMO_WORKSPACE_ROOT, files: this.files(), stats: this.stats() };
  }

  read(path: string): DocumentView {
    const doc = this.documents.get(path);
    if (!doc) throw new Error(`Document not found: ${path}`);
    const { tags } = frontMatter(doc.content);
    return { path, content: doc.content, wordCount: countWords(doc.content), tags };
  }

  save(path: string, content: string, tags: string[]): DocumentResult {
    const doc = this.documents.get(path);
    if (!doc) throw new Error(`Document not found: ${path}`);
    const nextContent = withTags(content, tags);
    const previousWords = this.baselineWordCounts.get(path) ?? 0;
    const nextWords = countWords(nextContent);
    const delta = nextWords - previousWords;
    if (delta > 0) this.sessionWordsAdded += delta;
    if (delta < 0) this.sessionWordsDeleted += -delta;
    if (delta !== 0) this.sessionActiveDocuments.add(path);
    this.baselineWordCounts.set(path, nextWords);
    doc.content = nextContent;
    return { workspace: this.workspace(), document: this.read(path) };
  }

  create(name: string): DocumentResult {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a document name.");
    const fileName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
    if (this.documents.has(fileName)) {
      throw new Error(`${fileName} already exists.`);
    }
    const content = `# ${trimmed.replace(/\.md$/i, "")}\n\n`;
    this.documents.set(fileName, { path: fileName, content });
    this.baselineWordCounts.set(fileName, 0);
    return { workspace: this.workspace(), document: this.read(fileName) };
  }

  rename(path: string, name: string): DocumentResult {
    const doc = this.documents.get(path);
    if (!doc) throw new Error(`Document not found: ${path}`);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a document name.");
    const fileName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
    if (fileName !== path && this.documents.has(fileName)) {
      throw new Error(`${fileName} already exists.`);
    }
    this.documents.delete(path);
    this.documents.set(fileName, { path: fileName, content: doc.content });
    const words = this.baselineWordCounts.get(path) ?? 0;
    this.baselineWordCounts.delete(path);
    this.baselineWordCounts.set(fileName, words);
    return { workspace: this.workspace(), document: this.read(fileName) };
  }

  analytics(): AnalyticsView {
    const today: DemoDayHistory = {
      date: isoDate(daysAgo(0)),
      wordsAdded: this.sessionWordsAdded,
      wordsDeleted: this.sessionWordsDeleted,
      activeDocuments: this.sessionActiveDocuments.size,
    };
    const daily: DailyActivity[] = [...seededHistory, today].map((day) => ({
      date: day.date,
      wordsAdded: day.wordsAdded,
      wordsDeleted: day.wordsDeleted,
      netChange: day.wordsAdded - day.wordsDeleted,
      activeDocuments: day.activeDocuments,
    }));

    const documents: DocumentActivity[] = this.files().map((path) => {
      const seeded = seededPerDocument.get(path) ?? { wordsAdded: 0, wordsDeleted: 0 };
      const doc = this.documents.get(path)!;
      const currentWordCount = this.baselineWordCounts.get(path) ?? countWords(doc.content);
      const { tags } = frontMatter(doc.content);
      return {
        path,
        currentWordCount,
        wordsAdded: seeded.wordsAdded,
        wordsDeleted: seeded.wordsDeleted,
        netChange: seeded.wordsAdded - seeded.wordsDeleted,
        tags,
      };
    });

    const tagTotals = new Map<string, TagActivity>();
    for (const doc of documents) {
      for (const tag of doc.tags) {
        const existing = tagTotals.get(tag) ?? { tag, documents: 0, wordsAdded: 0, wordsDeleted: 0, netChange: 0 };
        existing.documents += 1;
        existing.wordsAdded += doc.wordsAdded;
        existing.wordsDeleted += doc.wordsDeleted;
        existing.netChange += doc.netChange;
        tagTotals.set(tag, existing);
      }
    }

    return {
      daily,
      documents,
      activeDays: daily.filter((day) => day.wordsAdded > 0).length,
      activeDocuments: documents.length,
      currentWordCount: documents.reduce((sum, doc) => sum + doc.currentWordCount, 0),
      tags: [...tagTotals.values()],
    };
  }
}

const store = new DemoStore();

export function demoOpenWorkspace(): WorkspaceView {
  return store.workspace();
}

export function demoRefreshWorkspace(): WorkspaceView {
  return store.workspace();
}

export function demoReadDocument(path: string): DocumentView {
  return store.read(path);
}

export function demoSaveDocument(path: string, content: string, tags: string[]): DocumentResult {
  return store.save(path, content, tags);
}

export function demoCreateDocument(name: string): DocumentResult {
  return store.create(name);
}

export function demoRenameDocument(path: string, name: string): DocumentResult {
  return store.rename(path, name);
}

export function demoQueryAnalytics(): AnalyticsView {
  return store.analytics();
}
