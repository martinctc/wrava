import { useEffect, useRef, useState } from "react";
import type { SpellingRequest } from "./spellingEditors";

export function SpellingMenu({ request, onClose }: { request: SpellingRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  function close() {
    dialog.current?.close();
    onClose();
  }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(request.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(request.y, window.innerHeight - rect.height - 8))}px`;
  }, [request]);

  return (
    <dialog ref={dialog} className="spelling-menu" aria-label={`Spelling suggestions for ${request.word}`}
      onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => event.stopPropagation()}>
      <strong>{request.word}</strong>
      {request.suggestions.length ? request.suggestions.map(word => (
        <button key={word} onClick={() => {
          try {
            request.replace(word);
            close();
          } catch (error) { setError(String(error)); }
        }}>{word}</button>
      )) : <p>No suggestions found.</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      <button onClick={close}>Cancel</button>
    </dialog>
  );
}
