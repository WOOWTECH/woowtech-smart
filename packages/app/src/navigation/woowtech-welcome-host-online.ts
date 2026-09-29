export interface WelcomeHostOnlineInput {
  /** The first host that is online (useAnyHostOnline), or null. */
  anyOnlineServerId: string | null;
  /** Whether the welcome screen is the focused screen (useIsFocused). */
  isFocused: boolean;
}

/**
 * woowtech smart: the welcome screen moves on to the host only while it is the focused screen
 * (woowtech/README.md section 16, the first notification tap after pairing).
 *
 * Pairing through a link or the in-app QR scanner replaces the screen above the welcome screen,
 * so the welcome screen stays mounted at the bottom of the root stack. router.replace replaces
 * the focused route of the stack, not the screen that calls it. Upstream moved on whenever a host
 * came online, so every reconnect turned the screen the user was on into /open-project: after a
 * notification tap, that was the workspace still waiting for the host to open the agent. The
 * welcome screen lists isFocused among the effect's dependencies, so it still moves on when it
 * shows again while a host is online.
 */
export function shouldWelcomeMoveOnToHost(input: WelcomeHostOnlineInput): boolean {
  return Boolean(input.anyOnlineServerId) && input.isFocused;
}
