// woowtech smart (fork-owned; woowtech/README.md, 19): the web app drops a pairing offer from the
// address bar as soon as it reads the link, so the credential does not stay in the address bar,
// a bookmark or a reload, and the message events that report the address (expo-linking's web
// "url" event) do not bring the link back. The browser's history keeps the address it first
// loaded; a page cannot change that. Electron's addresses carry no offer.

export function clearPairingLinkFromAddressBar(): void {
  // The unit tests resolve .web files too, and run without a window.
  if (typeof window === "undefined") return;
  const { location, history } = window;
  if (!location.hash.includes("offer=")) return;
  // expo-router keeps its own entry state ({ id }) in history.state.
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
}

/** Every message event reports the same address again; a link handled once is not handled again. */
export const REMEMBER_HANDLED_PAIRING_LINKS = true;
