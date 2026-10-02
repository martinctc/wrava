const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our",
  "out", "day", "get", "have", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who",
  "boy", "did", "its", "let", "put", "say", "she", "too", "use", "her", "way", "many", "over", "such",
  "take", "than", "them", "well", "were", "that", "with", "this", "from", "they", "know", "want", "been", "good",
  "much", "some", "time", "very", "when", "make", "like", "will", "just", "first", "other", "after", "back",
  "little", "only", "other", "some", "there", "their", "what", "when", "which", "while", "world", "would",
  "there", "think", "where", "being", "every", "great", "through", "during", "before", "should", "now", "each",
  "find", "work", "part", "life", "call", "come", "also", "after", "use", "her", "way", "many", "over", "such",
  "take", "than", "them", "well", "were", "that", "with", "this", "from", "they", "know", "want", "been", "good",
  "more", "around", "another", "come", "make", "most", "other", "some", "time", "very", "after", "back", "only",
  "other", "many", "over", "before", "after", "between", "under", "right", "left", "high", "low", "early", "late",
  "here", "there", "when", "where", "why", "how", "all", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "can", "will", "just", "should", "now",
  "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "done",
  "doing", "would", "could", "should", "may", "might", "must", "can", "need", "dare", "ought", "used", "get",
  "got", "getting", "gets", "go", "going", "went", "gone", "come", "coming", "came", "leave", "leaving", "left",
  "feel", "feeling", "felt", "think", "thinking", "thought", "say", "saying", "said", "tell", "telling", "told",
  "work", "working", "worked", "try", "trying", "tried", "need", "needing", "needed", "help", "helping", "helped",
  "show", "showing", "showed", "hear", "hearing", "heard", "play", "playing", "played", "run", "running", "ran",
  "move", "moving", "moved", "live", "living", "lived", "believe", "believing", "believed", "bring", "bringing",
  "brought", "happen", "happening", "happened", "stand", "standing", "stood", "lose", "losing", "lost", "pay",
  "paying", "paid", "meet", "meeting", "met", "include", "including", "included", "continue", "continuing", "continued",
  "set", "setting", "set", "learn", "learning", "learned", "change", "changing", "changed", "lead", "leading", "led",
  "understand", "understanding", "understood", "watch", "watching", "watched", "follow", "following", "followed",
  "stop", "stopping", "stopped", "create", "creating", "created", "speak", "speaking", "spoke", "spoken", "read",
  "reading", "read", "allow", "allowing", "allowed", "add", "adding", "added", "spend", "spending", "spent",
  "grow", "growing", "grew", "grown", "open", "opening", "opened", "walk", "walking", "walked", "win", "winning",
  "offer", "offering", "offered", "remember", "remembering", "remembered", "love", "loving", "loved", "consider",
  "considering", "considered", "appear", "appearing", "appeared", "buy", "buying", "bought", "wait", "waiting",
  "waited", "serve", "serving", "served", "die", "dying", "died", "send", "sending", "sent", "expect", "expecting",
  "expected", "build", "building", "built", "stay", "staying", "stayed", "fall", "falling", "fell", "fallen",
  "cut", "cutting", "cut", "reach", "reaching", "reached", "kill", "killing", "killed", "remain", "remaining",
  "remained", "suggest", "suggesting", "suggested", "raise", "raising", "raised", "pass", "passing", "passed",
  "sell", "selling", "sold", "require", "requiring", "required", "report", "reporting", "reported", "decide",
  "deciding", "decided", "pull", "pulling", "pulled",
]);

import type { BigramResult } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

export function computeBigrams(contents: string[]): BigramResult[] {
  const counts = new Map<string, number>();
  for (const content of contents) {
    // Strip YAML front matter before tokenizing
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
    const tokens = tokenize(body);
    for (let i = 0; i < tokens.length - 1; i++) {
      const phrase = `${tokens[i]} ${tokens[i + 1]}`;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
