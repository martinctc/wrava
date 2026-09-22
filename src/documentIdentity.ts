import { markdownLanguage } from "@codemirror/lang-markdown";
import type { FilenamePreferences } from "./settings";

export const MAX_GENERATED_FILENAME_LENGTH = 80;

export function documentFilename(name: string) {
  const stem = name.trim().replace(/\.md$/i, "").trim();
  if (!stem) throw new Error("Enter a name for the new document.");
  if (/[<>:"/\\|?*\x00-\x1f]/.test(stem) || stem.endsWith(".")) {
    throw new Error("Use a file name without slashes or Windows-reserved characters.");
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)) {
    throw new Error("That name is reserved by Windows. Choose another name.");
  }
  if (stem.length + 3 > 255) throw new Error("Use a file name of at most 255 characters including .md.");
  return `${stem}.md`;
}

export function localDatePrefix(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function suggestedFilename(title: string, date = new Date(), preferences: FilenamePreferences = { includeDate: true, maxLength: MAX_GENERATED_FILENAME_LENGTH }) {
  const prefix = preferences.includeDate ? `${localDatePrefix(date)}_` : "";
  const rawSlug = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "untitled";
  const slug = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(rawSlug) ? `note-${rawSlug}` : rawSlug;
  const shortened = Array.from(slug).slice(0, preferences.maxLength - prefix.length - 3)
    .join("").replace(/-+$/, "");
  return `${prefix}${shortened}.md`;
}

export function titleMarkdown(title: string) {
  const trimmed = title.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) throw new Error("Enter a title on a single line.");
  return trimmed.replace(/[\\`*_[\]<>#~]/g, "\\$&");
}

export function splitMarkdownDocument(markdown: string) {
  const match = markdown.match(/^(---(?:\r?\n))[\s\S]*?(\r?\n---(?:\r?\n|$))/);
  const boundary = match?.[0].length ?? 0;
  return { frontMatter: markdown.slice(0, boundary), body: markdown.slice(boundary) };
}

function firstHeading(body: string) {
  const tree = markdownLanguage.parser.parse(body);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "ATXHeading1" || node.name === "SetextHeading1") return node;
  }
  return null;
}

export function writingTitle(content: string) {
  const { body } = splitMarkdownDocument(content);
  const heading = firstHeading(body);
  if (!heading) return "";
  let title = "";
  const ignored = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "LinkMark", "URL"]);
  // Inline text between syntax nodes is not represented by leaf nodes.
  let from = heading.from;
  const marks: { from: number; to: number }[] = [];
  heading.node.cursor().iterate((node) => {
    if (ignored.has(node.name)) {
      marks.push({ from: node.from, to: node.to });
      return false;
    }
  });
  for (const mark of marks) {
    title += body.slice(from, mark.from);
    from = mark.to;
  }
  title += body.slice(from, heading.to);
  return title.replace(/\\([\\`*_[\]<>#~])/g, "$1").trim();
}

export function withWritingTitle(content: string, title: string) {
  const text = titleMarkdown(title);
  const { frontMatter, body } = splitMarkdownDocument(content);
  const heading = firstHeading(body);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const replacement = `# ${text}`;
  if (heading) {
    const end = body[heading.to - 1] === "\r" ? heading.to - 1 : heading.to;
    return frontMatter + body.slice(0, heading.from) + replacement + body.slice(end);
  }
  return `${frontMatter}${frontMatter && !frontMatter.endsWith("\n") ? newline : ""}${replacement}${newline}${newline}${body}`;
}
