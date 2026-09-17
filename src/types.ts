// Shared view models exchanged between the frontend and either backend:
// the real Tauri/Rust core, or the in-browser demo backend used on the
// GitHub Pages site (see backend.ts).

export type ActivityStats = {
  todayAdded: number;
  weekAdded: number;
  monthAdded: number;
  yearAdded: number;
  todayNet: number;
  weekNet: number;
  monthNet: number;
  yearNet: number;
  todayDocuments: number;
  weekDocuments: number;
  monthDocuments: number;
  yearDocuments: number;
};

export type WorkspaceView = {
  root: string;
  files: string[];
  stats: ActivityStats;
};

export type DocumentView = {
  path: string;
  content: string;
  wordCount: number;
  tags: string[];
};

export type DocumentResult = {
  workspace: WorkspaceView;
  document: DocumentView;
};

export type DailyActivity = {
  date: string;
  wordsAdded: number;
  wordsDeleted: number;
  netChange: number;
  activeDocuments: number;
};

export type DocumentActivity = {
  path: string;
  currentWordCount: number;
  wordsAdded: number;
  wordsDeleted: number;
  netChange: number;
  tags: string[];
};

export type TagActivity = {
  tag: string;
  documents: number;
  wordsAdded: number;
  wordsDeleted: number;
  netChange: number;
};

export type AnalyticsView = {
  daily: DailyActivity[];
  documents: DocumentActivity[];
  activeDays: number;
  activeDocuments: number;
  currentWordCount: number;
  tags: TagActivity[];
};

export const emptyStats: ActivityStats = {
  todayAdded: 0,
  weekAdded: 0,
  monthAdded: 0,
  yearAdded: 0,
  todayNet: 0,
  weekNet: 0,
  monthNet: 0,
  yearNet: 0,
  todayDocuments: 0,
  weekDocuments: 0,
  monthDocuments: 0,
  yearDocuments: 0,
};
