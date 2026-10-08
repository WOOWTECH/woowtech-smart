// woowtech smart (woowtech/README.md section 25): on iOS, people go back with a swipe from the left
// edge, and on settings pages it did nothing (RC-I-09f, 2026-09-30) while the header's back button
// worked. Two things stood in the way:
// - The root stack shows its screens without animation (app/_layout.tsx ROOT_STACK_SCREEN_OPTIONS),
//   and react-native-screens hands a no-animation pop to its own animator, which no swipe can drive.
// - Screen-edge recognizers do not start in this app: on the iOS 27 simulator on 2026-10-08, an
//   XCUITest drag from the left edge went back in the Settings app, but in this app neither UIKit's
//   swipe back nor the screen-edge recognizer react-native-screens adds for custom animations
//   reacted. Its full-screen pan recognizer did, so settings pages use that one and take only drags
//   that start near the left edge, which keeps it an edge swipe.
// On an iPhone-width layout, settings pages are pushed one over another. A wider layout replaces one
// settings page with the next (settings-screen.tsx handleSelectSection), where an animation would
// slide on every section change, so it keeps none.
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform, useWindowDimensions } from "react-native";

/** Widths under the md breakpoint (styles/unistyles.ts) are compact, as in useIsCompactFormFactor. */
export const SETTINGS_SWIPE_BACK_MAX_WIDTH = 720;

/** How far from the left edge a swipe back may start, in points. */
export const SETTINGS_SWIPE_BACK_EDGE_WIDTH = 50;

export type SettingsSwipeBackOptions = Pick<
  NativeStackNavigationOptions,
  "animation" | "gestureEnabled" | "fullScreenGestureEnabled" | "gestureResponseDistance"
>;

const SWIPE_BACK_OPTIONS: SettingsSwipeBackOptions = {
  animation: "default",
  gestureEnabled: true,
  fullScreenGestureEnabled: true,
  gestureResponseDistance: { end: SETTINGS_SWIPE_BACK_EDGE_WIDTH },
};

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
