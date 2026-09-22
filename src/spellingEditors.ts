import { Decoration as CMDecoration, EditorView as CMView, ViewPlugin, type DecorationSet as CMDecorationSet, type ViewUpdate } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import type { SpellingLanguage } from "./settings";
import { markdownSpellingIssues, spellingIssues, type SpellingChecker, type SpellingIssue } from "./spellcheckCore";

export type SpellingOptions = { language: SpellingLanguage; checker: SpellingChecker | null };
export type SpellingRequest = {
  word: string;
  suggestions: string[];
  x: number;
  y: number;
  replace: (word: string) => void;
};
type OpenSpelling = (request: SpellingRequest) => void;

export function spellingAttributes(language: SpellingLanguage) {
  return {
    spellcheck: String(language === "system"),
    autocorrect: language === "system" ? "on" : "off",
    lang: language === "en-GB" || language === "en-US" ? language : navigator.language,
  };
}

const spellingMark = (word: string) => ({
  class: "spelling-error",
  "data-spelling-word": word,
  title: `Check spelling: ${word}. Right-click or press Alt+Enter for suggestions.`,
});

const sourceSpellingResults = StateEffect.define<SpellingIssue[]>();

export function sourceSpelling(options: SpellingOptions, open: OpenSpelling) {
  return [
    CMView.contentAttributes.of(spellingAttributes(options.language)),
    ViewPlugin.fromClass(class {
      decorations: CMDecorationSet = CMDecoration.none;
      issues: SpellingIssue[] = [];
      timer: ReturnType<typeof setTimeout> | undefined;
      constructor(readonly view: CMView) { this.schedule(); }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const issues = options.checker ? markdownSpellingIssues(this.view.state.doc.toString(), options.checker) : [];
          this.view.dispatch({ effects: sourceSpellingResults.of(issues) });
        }, 200);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.issues = [];
          this.decorations = this.decorations.map(update.changes);
          this.schedule();
        }
        for (const transaction of update.transactions) {
          for (const effect of transaction.effects) {
            if (effect.is(sourceSpellingResults)) {
              this.issues = effect.value;
              this.decorations = CMDecoration.set(this.issues.map(issue =>
                CMDecoration.mark({ attributes: spellingMark(issue.word) }).range(issue.from, issue.to)));
            }
          }
        }
      }
      destroy() { clearTimeout(this.timer); }
      show(position: number | null, x: number, y: number) {
        if (position === null || !options.checker) return false;
        const issue = this.issues.find(item => position >= item.from && position <= item.to);
        if (!issue) return false;
        const doc = this.view.state.doc;
        open({ word: issue.word, suggestions: options.checker.suggest(issue.word), x, y, replace: word => {
          if (this.view.state.doc !== doc) throw new Error("The writing changed. Reopen spelling suggestions.");
          this.view.dispatch({
            changes: { from: issue.from, to: issue.to, insert: word },
            annotations: isolateHistory.of("full"),
          });
          this.view.focus();
        } });
        return true;
      }
    }, {
      decorations: plugin => plugin.decorations,
      eventHandlers: {
        contextmenu(event) {
          const handled = this.show(this.view.posAtCoords({ x: event.clientX, y: event.clientY }), event.clientX, event.clientY);
          if (handled) event.preventDefault();
          return handled;
        },
        keydown(event) {
          if (!event.altKey || event.key !== "Enter") return false;
          const position = this.view.state.selection.main.head;
          const rect = this.view.coordsAtPos(position);
          const handled = this.show(position, rect?.left ?? 0, rect?.bottom ?? 0);
          if (handled) event.preventDefault();
          return handled;
        },
      },
    }),
  ];
}

export const richSpellingKey = new PluginKey<DecorationSet>("wrava-spelling");

function richIssues(doc: ProseNode, checker: SpellingChecker) {
  const result: SpellingIssue[] = [];
  doc.descendants((node, position) => {
    if (node.type.spec.code || node.type.name === "html") return false;
    if (node.isText && node.text && !node.marks.some(mark => mark.type.spec.code)) {
      result.push(...spellingIssues(node.text, checker, position));
    }
  });
  return result;
}

export function richSpelling(getOptions: () => SpellingOptions, open: OpenSpelling) {
  const show = (view: EditorView, position: number | undefined, x: number, y: number) => {
    const { checker } = getOptions();
    if (position === undefined || !checker) return false;
    const match = richSpellingKey.getState(view.state)?.find(position, position)[0];
    if (!match) return false;
    const word = view.state.doc.textBetween(match.from, match.to);
    const doc = view.state.doc;
    open({ word, suggestions: checker.suggest(word), x, y, replace: replacement => {
      if (view.state.doc !== doc) throw new Error("The writing changed. Reopen spelling suggestions.");
      view.dispatch(closeHistory(view.state.tr.insertText(replacement, match.from, match.to)));
      view.dispatch(closeHistory(view.state.tr));
      view.focus();
    } });
    return true;
  };

  return $prose(() => new Plugin({
    key: richSpellingKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const next = tr.getMeta(richSpellingKey);
        if (next instanceof DecorationSet) return next;
        return tr.docChanged ? previous.map(tr.mapping, tr.doc) : previous;
      },
    },
    props: {
      attributes: () => spellingAttributes(getOptions().language),
      decorations: state => richSpellingKey.getState(state),
      handleDOMEvents: {
        contextmenu(view, event) {
          const handled = show(view, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos, event.clientX, event.clientY);
          if (handled) event.preventDefault();
          return handled;
        },
      },
      handleKeyDown(view, event) {
        if (!event.altKey || event.key !== "Enter") return false;
        // Chromium can deliver a key press before the click's selectionchange event.
        const selection = view.dom.ownerDocument.getSelection();
        const position = selection?.focusNode && view.dom.contains(selection.focusNode)
          ? view.posAtDOM(selection.focusNode, selection.focusOffset)
          : view.state.selection.head;
        const rect = view.coordsAtPos(position);
        return show(view, position, rect.left, rect.bottom);
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout>;
      let previousOptions = getOptions();
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const { checker } = getOptions();
          const decorations = checker ? richIssues(view.state.doc, checker).map(issue =>
            Decoration.inline(issue.from, issue.to, spellingMark(issue.word))) : [];
          view.dispatch(view.state.tr.setMeta(richSpellingKey, DecorationSet.create(view.state.doc, decorations)));
        }, 200);
      };
      refresh();
      return {
        update(current, previous) {
          const options = getOptions();
          if (current.state.doc !== previous.doc || options.language !== previousOptions.language || options.checker !== previousOptions.checker) {
            previousOptions = options;
            refresh();
          }
        },
        destroy() { clearTimeout(timer); },
      };
    },
  }));
}
