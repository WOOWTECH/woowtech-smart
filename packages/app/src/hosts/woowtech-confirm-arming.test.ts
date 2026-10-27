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

  it("does not count without a press-in, as a click sent by a script has none", () => {
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

describe("on a phone", () => {
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
