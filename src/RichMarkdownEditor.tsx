import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { richSpelling, richSpellingKey, type SpellingOptions, type SpellingRequest } from "./spellingEditors";

export function RichMarkdownEditor({
  markdown,
  onChange,
  editorRef,
  onError,
  spelling,
  onSpelling,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  editorRef: React.RefObject<Crepe | null>;
  onError: (message: string) => void;
  spelling: SpellingOptions;
  onSpelling: (request: SpellingRequest) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(markdown);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const spellingRef = useRef(spelling);
  spellingRef.current = spelling;
  const onSpellingRef = useRef(onSpelling);
  onSpellingRef.current = onSpelling;

  useEffect(() => {
    editorRef.current?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(richSpellingKey, "refresh"));
    });
  }, [editorRef, spelling]);

  useEffect(() => {
    if (!rootRef.current) return;
    let disposed = false;

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialMarkdownRef.current,
      features: {
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Table]: false,
        [Crepe.Feature.TopBar]: true,
      },
    });
    crepe.editor.use(richSpelling(() => spellingRef.current, request => onSpellingRef.current(request)));
    crepe.on((listener) => {
      listener.markdownUpdated((_context, nextMarkdown, previousMarkdown) => {
        if (!disposed && nextMarkdown !== previousMarkdown) {
          onChangeRef.current(nextMarkdown);
        }
      });
    });

    void crepe.create().then(() => {
      if (!disposed) editorRef.current = crepe;
    }).catch((error) => onErrorRef.current(`Could not start the rich editor: ${String(error)}`));
    return () => {
      disposed = true;
      if (editorRef.current === crepe) editorRef.current = null;
      void crepe.destroy().catch((error) => onErrorRef.current(`Could not close the rich editor: ${String(error)}`));
    };
  }, [editorRef]);

  return <div className="rich-editor" ref={rootRef} />;
}