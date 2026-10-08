// woowtech smart (woowtech/README.md section 14): on iOS, people go back with an edge swipe. The
// root stack shows its screens without animation (app/_layout.tsx ROOT_STACK_SCREEN_OPTIONS), and
// react-native-screens hands a no-animation pop to its own animator, which the edge swipe cannot
// drive: on 2026-09-30 the swipe did nothing on a settings page (RC-I-09f), while the header's back
// button worked. On an iPhone-width layout, settings pages are pushed one over another, so they get
// the platform's push animation and with it the swipe back. A wider layout replaces one settings
// page with the next (settings-screen.tsx handleSelectSection), where an animation would slide on
// every section change, so it keeps none.
import { Platform, useWindowDimensions } from "react-native";

/** Widths under the md breakpoint (styles/unistyles.ts) are compact, as in useIsCompactFormFactor. */
export const SETTINGS_SWIPE_BACK_MAX_WIDTH = 720;

export interface SettingsSwipeBackOptions {
  animation: "default";
  gestureEnabled: true;
}

const SWIPE_BACK_OPTIONS: SettingsSwipeBackOptions = { animation: "default", gestureEnabled: true };

export function settingsScreenOptionsFor(input: {
  os: string;
  windowWidth: number;
}): SettingsSwipeBackOptions | undefined {
  if (input.os !== "ios" || input.windowWidth >= SETTINGS_SWIPE_BACK_MAX_WIDTH) {
    return undefined;
  }
  return SWIPE_BACK_OPTIONS;
}

/**
 * Options for the root stack's settings screens. Reads the window width rather than the Unistyles
 * runtime, so the route tree does not re-render on every Unistyles update (docs/expo-router.md).
 */
export function useSettingsScreenOptions(): SettingsSwipeBackOptions | undefined {
  const { width } = useWindowDimensions();
  return settingsScreenOptionsFor({ os: Platform.OS, windowWidth: width });
}
