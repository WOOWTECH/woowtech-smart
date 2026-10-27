/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import type { AppStateStatus } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARMING_DELAY_MS,
  nativeArmingEnvironment,
  useConnectArming,
  webArmingEnvironment,
  type ArmingEnvironment,
} from "./woowtech-confirm-arming";

// DoubleClickjacking (evil.blog, 2024-12): a page opens a popup and sends its own tab to a pairing
// link; the popup closes on the first press of a double click and the second lands on Connect.

let focused = true;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  focused = true;
  visibility = "visible";
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const WEB = webArmingEnvironment(window, document);
// jsdom matches :focus-visible on anything focused, so the browser's answer is stated here.
const KEYBOARD_FOCUS: ArmingEnvironment = { ...WEB, focusCameFromKeyboard: () => true };
const POINTER_FOCUS: ArmingEnvironment = { ...WEB, focusCameFromKeyboard: () => false };
const MOUSE_DOWN = { nativeEvent: { type: "mousedown" } };
const TOUCH_START = { nativeEvent: { type: "touchstart" } };
const KEY_DOWN = { nativeEvent: { type: "keydown", repeat: false } };
const REPEATED_KEY_DOWN = { nativeEvent: { type: "keydown", repeat: true } };

function sheet(environment: ArmingEnvironment = WEB) {
  return renderHook(({ requestId }) => useConnectArming(requestId, environment), {
    initialProps: { requestId: 1 },
  });
}

type Arming = ReturnType<typeof sheet>;

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function windowEvent(type: string): void {
  act(() => {
    window.dispatchEvent(new Event(type));
  });
}

function pointer(arming: Arming, kind: "move" | "down", pointerType: string): void {
  const event = { nativeEvent: { pointerType } };
  act(() => {
    if (kind === "move") arming.result.current.onPointerMove(event);
    else arming.result.current.onPointerDown(event);
  });
}

/** One press of Connect: its press-in, then its press. Whether the press counted. */
function press(arming: Arming, pressIn: unknown): boolean {
  arming.result.current.onConnectPressIn(pressIn);
  return arming.result.current.acceptPress();
}

function appState(initial: AppStateStatus) {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const fake = {
    currentState: initial,
    addEventListener(_type: "change", listener: (state: AppStateStatus) => void) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    change(next: AppStateStatus) {
      fake.currentState = next;
      act(() => {
        for (const listener of listeners) listener(next);
      });
    },
    listening: () => listeners.size,
  };
  return fake;
}

/** Connect's onFocus for a focus that reached `target`; true when the sheet takes the focus back. */
function focusConnect(arming: Arming, target: object = {}): boolean {
  let release = false;
  act(() => {
    release = arming.result.current.onConnectFocus({ target });
  });
  return release;
}

describe("arming Connect", () => {
  it("arms after the sheet has been visible and focused for a second", () => {
    const arming = sheet();

    wait(ARMING_DELAY_MS - 1);
    expect(arming.result.current.armed).toBe(false);
    wait(1);
    expect(arming.result.current.armed).toBe(true);
    expect(ARMING_DELAY_MS).toBe(1000);
  });

  it("starts the second again when the window loses focus and gets it back", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);

    focused = false;
    windowEvent("blur");
    expect(arming.result.current.armed).toBe(false);
    wait(5 * ARMING_DELAY_MS);
    expect(arming.result.current.armed).toBe(false);

    focused = true;
    windowEvent("focus");
    wait(ARMING_DELAY_MS - 1);
    expect(arming.result.current.armed).toBe(false);
    wait(1);
    expect(arming.result.current.armed).toBe(true);
  });

  it("starts the second again when the page is hidden and shown", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);

    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(arming.result.current.armed).toBe(false);
    wait(5 * ARMING_DELAY_MS);
    expect(arming.result.current.armed).toBe(false);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    wait(ARMING_DELAY_MS - 1);
    expect(arming.result.current.armed).toBe(false);
    wait(1);
    expect(arming.result.current.armed).toBe(true);
  });

  it("starts the second again on pagehide, pageshow, resize and a focus event while armed", () => {
    const arming = sheet();
    for (const type of ["pagehide", "pageshow", "resize", "focus"]) {
      wait(ARMING_DELAY_MS);
      expect(arming.result.current.armed).toBe(true);
      windowEvent(type);
      expect({ type, armed: arming.result.current.armed }).toEqual({ type, armed: false });
    }
  });

  it("starts the second again for a new question", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);

    arming.rerender({ requestId: 2 });
    expect(arming.result.current.armed).toBe(false);
    wait(ARMING_DELAY_MS);
    expect(arming.result.current.armed).toBe(true);
  });

  it("stays unarmed while the window has no focus", () => {
    focused = false;
    const arming = sheet();
    wait(10 * ARMING_DELAY_MS);
    expect(arming.result.current.armed).toBe(false);
  });
});

describe("a press of Connect", () => {
  it("does not count when it began before Connect was armed", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS / 2);
    arming.result.current.onConnectPressIn(MOUSE_DOWN);

    wait(ARMING_DELAY_MS);
    pointer(arming, "move", "mouse");
    expect(arming.result.current.acceptPress()).toBe(false);
  });

  it("does not count without a press-in in a browser, as a click sent by a script has none", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);
    pointer(arming, "move", "mouse");
    expect(arming.result.current.acceptPress()).toBe(false);
  });

  it("from a mouse counts only after the mouse moved over the sheet once armed", () => {
    const arming = sheet();
    pointer(arming, "move", "mouse");
    wait(ARMING_DELAY_MS);

    expect(press(arming, MOUSE_DOWN)).toBe(false);
    pointer(arming, "down", "mouse");
    expect(press(arming, MOUSE_DOWN)).toBe(false);
    pointer(arming, "move", "mouse");
    expect(press(arming, MOUSE_DOWN)).toBe(true);
  });

  it("from a touch or a pen counts once armed: the pointerdown itself is the gesture", () => {
    const arming = sheet();
    expect(press(arming, TOUCH_START)).toBe(false);
    wait(ARMING_DELAY_MS);

    expect(press(arming, TOUCH_START)).toBe(true);
    pointer(arming, "down", "pen");
    expect(press(arming, MOUSE_DOWN)).toBe(true);
  });

  it("from the keyboard counts after a Tab, but never from a key held down", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);
    expect(press(arming, KEY_DOWN)).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", repeat: true }));
    });
    expect(press(arming, KEY_DOWN)).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(press(arming, REPEATED_KEY_DOWN)).toBe(false);
    expect(press(arming, KEY_DOWN)).toBe(true);
  });

  it("counts a Tab from its key-up when the sheet's focus trap swallowed the key-down", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab" }));
    });
    expect(press(arming, KEY_DOWN)).toBe(true);
  });

  it("does not count when focus left between the press-in and the press", () => {
    const arming = sheet();
    wait(ARMING_DELAY_MS);
    pointer(arming, "move", "mouse");
    arming.result.current.onConnectPressIn(MOUSE_DOWN);
    windowEvent("blur");
    expect(arming.result.current.acceptPress()).toBe(false);
  });
});

describe("a press that never had a press-in", () => {
  // A screen reader's or a keyboard's activation reaches onPress with no onPressIn (Pressability's
  // onClick for accessibility clicks; react-native-web's click handler).
  it("counts on a phone once Connect is armed, and not before", () => {
    const arming = sheet(nativeArmingEnvironment(appState("active")));
    expect(arming.result.current.acceptPress()).toBe(false);

    wait(ARMING_DELAY_MS - 1);
    expect(arming.result.current.acceptPress()).toBe(false);
    wait(1);
    expect(arming.result.current.acceptPress()).toBe(true);
  });

  it("does not count on a phone after the app left the foreground", () => {
    const state = appState("active");
    const arming = sheet(nativeArmingEnvironment(state));
    wait(ARMING_DELAY_MS);

    state.change("background");
    expect(arming.result.current.acceptPress()).toBe(false);
    state.change("active");
    expect(arming.result.current.acceptPress()).toBe(false);
    wait(ARMING_DELAY_MS);
    expect(arming.result.current.acceptPress()).toBe(true);
  });

  it("counts in a browser only after the keyboard focused Connect once it was armed", () => {
    const arming = sheet(KEYBOARD_FOCUS);
    wait(ARMING_DELAY_MS);
    expect(arming.result.current.acceptPress()).toBe(false);

    expect(focusConnect(arming)).toBe(false);
    expect(arming.result.current.acceptPress()).toBe(true);
  });

  it("does not count in a browser when a click or a script focused Connect", () => {
    const arming = sheet(POINTER_FOCUS);
    wait(ARMING_DELAY_MS);

    expect(focusConnect(arming)).toBe(false);
    pointer(arming, "move", "mouse");
    expect(arming.result.current.acceptPress()).toBe(false);
  });

  it("forgets the keyboard focus when Connect loses it, and when the sheet disarms", () => {
    const arming = sheet(KEYBOARD_FOCUS);
    wait(ARMING_DELAY_MS);

    focusConnect(arming);
    act(() => arming.result.current.onConnectBlur());
    expect(arming.result.current.acceptPress()).toBe(false);

    focusConnect(arming);
    windowEvent("blur");
    wait(ARMING_DELAY_MS);
    expect(arming.result.current.acceptPress()).toBe(false);
  });

  it("does not count when the press-in began before Connect was armed", () => {
    const arming = sheet(KEYBOARD_FOCUS);
    wait(ARMING_DELAY_MS / 2);
    arming.result.current.onConnectPressIn(KEY_DOWN);

    wait(ARMING_DELAY_MS);
    focusConnect(arming);
    expect(arming.result.current.acceptPress()).toBe(false);
    // The press-in was used up by that press: a later activation is judged on its own.
    expect(arming.result.current.acceptPress()).toBe(true);
  });
});

describe("the focus Connect takes", () => {
  it("goes back to Cancel while Connect is not armed: a click focuses a disabled button", () => {
    for (const environment of [KEYBOARD_FOCUS, POINTER_FOCUS]) {
      const arming = sheet(environment);
      expect(focusConnect(arming)).toBe(true);
      wait(ARMING_DELAY_MS - 1);
      expect(focusConnect(arming)).toBe(true);
      wait(1);
      expect(focusConnect(arming)).toBe(false);
      arming.unmount();
    }
  });

  it("goes back to Cancel again after the window lost and regained the focus", () => {
    const arming = sheet(KEYBOARD_FOCUS);
    wait(ARMING_DELAY_MS);
    expect(focusConnect(arming)).toBe(false);

    windowEvent("blur");
    expect(focusConnect(arming)).toBe(true);
  });
});

describe("telling a keyboard's focus from a click's", () => {
  it("asks the browser whether the focus is visible", () => {
    const matches = vi.fn((selector: string) => selector === ":focus-visible");
    expect(WEB.focusCameFromKeyboard({ matches })).toBe(true);
    expect(matches).toHaveBeenCalledWith(":focus-visible");
    expect(WEB.focusCameFromKeyboard({ matches: () => false })).toBe(false);
  });

  it("says no for anything it cannot ask, and for a browser that does not know the selector", () => {
    expect(WEB.focusCameFromKeyboard(null)).toBe(false);
    expect(WEB.focusCameFromKeyboard(undefined)).toBe(false);
    expect(WEB.focusCameFromKeyboard({})).toBe(false);
    expect(WEB.focusCameFromKeyboard("button")).toBe(false);
    expect(
      WEB.focusCameFromKeyboard({
        matches: () => {
          throw new SyntaxError("not a valid selector");
        },
      }),
    ).toBe(false);
  });

  it("asks a real element in the page", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    // jsdom answers :focus-visible as :focus; a browser answers by how the focus came.
    expect(WEB.focusCameFromKeyboard(button)).toBe(true);
    button.remove();
  });

  it("never comes from the keyboard on a phone", () => {
    expect(nativeArmingEnvironment(appState("active")).focusCameFromKeyboard({})).toBe(false);
  });
});

describe("on a phone", () => {
  it("arms after a second in the foreground and starts again after the app comes back", () => {
    const state = appState("active");
    const arming = sheet(nativeArmingEnvironment(state));
    wait(ARMING_DELAY_MS);
    expect(arming.result.current.armed).toBe(true);

    state.change("background");
    expect(arming.result.current.armed).toBe(false);
    wait(5 * ARMING_DELAY_MS);
    expect(arming.result.current.armed).toBe(false);

    state.change("active");
    wait(ARMING_DELAY_MS - 1);
    expect(arming.result.current.armed).toBe(false);
    wait(1);
    expect(arming.result.current.armed).toBe(true);
    expect(press(arming, { nativeEvent: {} })).toBe(true);

    arming.unmount();
    expect(state.listening()).toBe(0);
  });
});
