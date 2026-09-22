import nspell from "nspell";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { splitMarkdownDocument } from "./documentIdentity.ts";

export type SpellingChecker = {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
};
export type SpellingIssue = { from: number; to: number; word: string };

export function createSpellingChecker(aff: string, dic: string): SpellingChecker {
  const dictionary = nspell(aff, dic);
  const cache = new Map<string, boolean>();
  const normalise = (word: string) => word.replace(/’/g, "'");
  return {
    correct(word) {
      const value = normalise(word);
      let result = cache.get(value);
      if (result === undefined) {
        result = dictionary.correct(value);
        if (cache.size >= 10000) cache.clear();
        cache.set(value, result);
      }
      return result;
    },
    suggest: (word) => dictionary.suggest(normalise(word)).slice(0, 5),
  };
}

export function spellingIssues(text: string, checker: SpellingChecker, offset = 0): SpellingIssue[] {
  const ignored = [...text.matchAll(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.\w+/g)];
  const issues: SpellingIssue[] = [];
  let ignoredIndex = 0;
  for (const match of text.matchAll(/\p{L}+(?:['’]\p{L}+)*/gu)) {
    while (ignoredIndex < ignored.length && ignored[ignoredIndex].index + ignored[ignoredIndex][0].length <= match.index) ignoredIndex++;
    const range = ignored[ignoredIndex];
    if (match[0].length > 64 || (range && match.index >= range.index && match.index < range.index + range[0].length)) continue;
    if (!checker.correct(match[0])) {
      issues.push({ from: offset + match.index, to: offset + match.index + match[0].length, word: match[0] });
    }
  }
  return issues;
}

export function markdownSpellingIssues(content: string, checker: SpellingChecker): SpellingIssue[] {
  const { frontMatter, body } = splitMarkdownDocument(content);
  const excluded: { from: number; to: number }[] = [];
  markdownLanguage.parser.parse(body).iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "InlineCode", "URL", "HTMLBlock", "HTMLTag", "LinkReference"].includes(node.name)) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  let start = 0;
  const result: SpellingIssue[] = [];
  for (const range of [...excluded, { from: body.length, to: body.length }]) {
    result.push(...spellingIssues(body.slice(start, range.from), checker, frontMatter.length + start));
    start = range.to;
  }
  return result;
}
