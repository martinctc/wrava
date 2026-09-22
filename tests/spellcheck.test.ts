import assert from "node:assert/strict";
import test from "node:test";
import gb from "dictionary-en-gb";
import us from "dictionary-en";
import { createSpellingChecker, markdownSpellingIssues, spellingIssues } from "../src/spellcheckCore.ts";

const british = createSpellingChecker(String(gb.aff), String(gb.dic));
const american = createSpellingChecker(String(us.aff), String(us.dic));

test("British and US spelling use distinct dictionaries", () => {
  for (const [uk, usa] of [["colour", "color"], ["organisation", "organization"], ["centre", "center"], ["behaviour", "behavior"], ["flavour", "flavor"]]) {
    assert.equal(british.correct(uk), true, uk);
    assert.equal(british.correct(usa), false, usa);
    assert.equal(american.correct(uk), false, uk);
    assert.equal(american.correct(usa), true, usa);
  }
  assert.ok(british.suggest("colur").includes("colour"));
  assert.ok(american.suggest("colur").includes("color"));
});

test("word positions preserve Unicode apostrophes and ignore URLs and email addresses", () => {
  const text = "We’re writing colour and speling. Visit https://wrava.example/qxyz or email qxyz@example.com";
  assert.deepEqual(spellingIssues(text, british).map(issue => issue.word), ["speling"]);
  const issue = spellingIssues(text, british, 7)[0];
  assert.equal(text.slice(issue.from - 7, issue.to - 7), "speling");
  assert.deepEqual(spellingIssues("q".repeat(1000), british), []);
});

test("Markdown spellcheck skips front matter, code and link destinations", () => {
  const text = "---\nauthor: Qxyz\n---\n# Colour\n\nA color and speling.\n\n`qxyz` [writing](https://qxyz.example)\n\n```js\nconst qxyz = true;\n```\n";
  assert.deepEqual(markdownSpellingIssues(text, british).map(issue => issue.word), ["color", "speling"]);
  for (const issue of markdownSpellingIssues(text, british)) {
    assert.equal(text.slice(issue.from, issue.to), issue.word);
  }
  assert.deepEqual(markdownSpellingIssues(text, american).map(issue => issue.word), ["Colour", "speling"]);
});
