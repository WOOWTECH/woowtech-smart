/** Inline shortcut recorders receive keys before host navigation and overlays. */
export function hasDomKeyboardCapture(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[data-paseo-keyboard-capture="true"]') !== null;
}
