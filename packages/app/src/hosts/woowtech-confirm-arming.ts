import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { isWeb } from "@/constants/platform";

// woowtech smart (fork-owned; woowtech/README.md, 19): when the host confirmation sheet lets
// Connect count. DoubleClickjacking (evil.blog, 2024-12) gets a press onto a button that appeared
// under the pointer: a popup closes on the first press of a double click, the page under it has
// just opened the pairing link, and the second press lands on Connect. Connect arms once the sheet
// has been visible and focused for a second, any change in focus or visibility starts that again,
// and a press counts only when it began armed after a new gesture inside the sheet. A touch or
// pen press is its own gesture: touch screens have no hover to move.

export const ARMING_DELAY_MS = 1000;

export type ConnectPressKind = "mouse" | "touch" | "pen" | "keyboard";

interface ConnectPress {
  kind: ConnectPressKind;
  /** A key held down, auto-repeating. */
  repeat: boolean;
}

/** Where the sheet runs: whether it can be seen and has focus, and what may change that. */
export interface ArmingEnvironment {
  isVisibleAndFocused(): boolean;
  /** Calls `onChange` on anything that may change visibility or focus; returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** Calls `onGesture` when the keyboard moves focus (Tab); returns the unsubscribe. */
  subscribeKeyboardGestures(onGesture: () => void): () => void;
  /** What a press-in without an event type came from. */
  defaultPressKind: ConnectPressKind;
}

/** Disarms on every change and arms again after ARMING_DELAY_MS of visibility and focus. */
class ConnectArming {
  private armed = false;
  private gestured = false;
  private pressCounts = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  isArmed(): boolean {
    return this.armed;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A new question, or a change in visibility or focus. */
  restart(visibleAndFocused: boolean): void {
    this.stop();
    if (!visibleAndFocused) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setArmed(true);
    }, ARMING_DELAY_MS);
  }

  /** A new gesture inside the sheet. Before Connect arms it does not count. */
  gesture(): void {
    if (this.armed) this.gestured = true;
  }

  pressIn(press: ConnectPress): void {
    const isOwnGesture = press.kind === "touch" || press.kind === "pen";
    this.pressCounts = this.armed && !press.repeat && (this.gestured || isOwnGesture);
  }

  /** Whether the press now ending began armed after a gesture. Each press-in counts once. */
  takePress(): boolean {
    const counts = this.armed && this.pressCounts;
    this.pressCounts = false;
    return counts;
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.gestured = false;
    this.pressCounts = false;
    this.setArmed(false);
  }

  private setArmed(armed: boolean): void {
    if (this.armed === armed) return;
    this.armed = armed;
    for (const listener of this.listeners) listener();
  }
}

const WEB_FOCUS_EVENTS = ["blur", "focus", "pagehide", "pageshow", "resize"] as const;

/** A browser tab or Electron: document visibility and focus, and the window's events. */
export function webArmingEnvironment(win: Window, doc: Document): ArmingEnvironment {
  return {
    isVisibleAndFocused: () => doc.visibilityState === "visible" && doc.hasFocus(),
    subscribe(onChange) {
      for (const type of WEB_FOCUS_EVENTS) win.addEventListener(type, onChange);
      doc.addEventListener("visibilitychange", onChange);
      return () => {
        for (const type of WEB_FOCUS_EVENTS) win.removeEventListener(type, onChange);
        doc.removeEventListener("visibilitychange", onChange);
      };
    },
    subscribeKeyboardGestures(onGesture) {
      // The key-up too: the sheet's focus trap swallows the key-down of a Tab that wraps around
      // (lib/overlay-root.ts).
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Tab" && !event.repeat) onGesture();
      };
      win.addEventListener("keydown", onKey, true);
      win.addEventListener("keyup", onKey, true);
      return () => {
        win.removeEventListener("keydown", onKey, true);
        win.removeEventListener("keyup", onKey, true);
      };
    },
    defaultPressKind: "mouse",
  };
}

interface AppStateSource {
  currentState: AppStateStatus;
  addEventListener(type: "change", listener: (state: AppStateStatus) => void): { remove(): void };
}

/** iOS and Android: the app in the foreground. Presses there are touches. */
export function nativeArmingEnvironment(appState: AppStateSource): ArmingEnvironment {
  return {
    isVisibleAndFocused: () => appState.currentState === "active",
    subscribe(onChange) {
      const subscription = appState.addEventListener("change", onChange);
      return () => subscription.remove();
    },
    subscribeKeyboardGestures: () => () => {},
    defaultPressKind: "touch",
  };
}

function platformArmingEnvironment(): ArmingEnvironment {
  return isWeb ? webArmingEnvironment(window, document) : nativeArmingEnvironment(AppState);
}

function eventField(event: unknown, field: string): unknown {
  if (typeof event !== "object" || event === null || !("nativeEvent" in event)) return undefined;
  const nativeEvent: unknown = event.nativeEvent;
  if (typeof nativeEvent !== "object" || nativeEvent === null) return undefined;
  return Reflect.get(nativeEvent, field);
}

/**
 * What a press-in came from. React Native Web starts presses from a mouse, touch or key event
 * and passes it along; the phone's responder events have no type.
 */
function pressOf(event: unknown, defaultKind: ConnectPressKind): ConnectPress {
  const type = eventField(event, "type");
  if (typeof type !== "string") return { kind: defaultKind, repeat: false };
  if (type.startsWith("key"))
    return { kind: "keyboard", repeat: eventField(event, "repeat") === true };
  if (type.startsWith("touch")) return { kind: "touch", repeat: false };
  const pointerType = eventField(event, "pointerType");
  if (pointerType === "touch" || pointerType === "pen") return { kind: pointerType, repeat: false };
  return { kind: "mouse", repeat: false };
}

interface PointerEventLike {
  nativeEvent: { pointerType?: string };
}

export interface ConnectArmingHandle {
  /** Connect is enabled. */
  armed: boolean;
  /** For the view around the sheet's content: moving a pointer over it is a gesture. */
  onPointerMove: (event: PointerEventLike) => void;
  /** For the view around the sheet's content: a touch or pen pointerdown is a gesture. */
  onPointerDown: (event: PointerEventLike) => void;
  /** Connect's onPressIn. */
  onConnectPressIn: (event: unknown) => void;
  /** In Connect's onPress: whether this press counts. */
  acceptPress: () => boolean;
}

/** The arming of Connect for the question `requestId`; a new id starts it again. */
export function useConnectArming(
  requestId: number,
  environment?: ArmingEnvironment,
): ConnectArmingHandle {
  const [arming] = useState(() => new ConnectArming());
  const env = useMemo(() => environment ?? platformArmingEnvironment(), [environment]);
  const subscribe = useCallback((listener: () => void) => arming.subscribe(listener), [arming]);
  const isArmed = useCallback(() => arming.isArmed(), [arming]);
  const armed = useSyncExternalStore(subscribe, isArmed, isArmed);

  useEffect(() => {
    const restart = (): void => arming.restart(env.isVisibleAndFocused());
    restart();
    const stopWatching = env.subscribe(restart);
    const stopKeyboard = env.subscribeKeyboardGestures(() => arming.gesture());
    return () => {
      stopWatching();
      stopKeyboard();
      arming.stop();
    };
  }, [arming, env, requestId]);

  const onPointerMove = useCallback(() => arming.gesture(), [arming]);
  const onPointerDown = useCallback(
    (event: PointerEventLike) => {
      const pointerType = event.nativeEvent.pointerType;
      if (pointerType === "touch" || pointerType === "pen") arming.gesture();
    },
    [arming],
  );
  const onConnectPressIn = useCallback(
    (event: unknown) => arming.pressIn(pressOf(event, env.defaultPressKind)),
    [arming, env],
  );
  const acceptPress = useCallback(() => arming.takePress(), [arming]);

  return { armed, onPointerMove, onPointerDown, onConnectPressIn, acceptPress };
}
