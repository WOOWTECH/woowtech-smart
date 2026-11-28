/** Inline shortcut recorders receive keys before host navigation and overlays. */
export function hasDomKeyboardCapture(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[data-paseo-keyboard-capture="true"]') !== null;
}

/** Inline recorders announce marker changes before a native menu can consume a key. */
export function subscribeDomKeyboardCapture(listener: (capturing: boolean) => void): () => void {
  const changed = () => listener(hasDomKeyboardCapture());
  document.addEventListener("paseo:dom-keyboard-capture-change", changed);
  changed();
  return () => {
    document.removeEventListener("paseo:dom-keyboard-capture-change", changed);
    listener(false);
  };
}
