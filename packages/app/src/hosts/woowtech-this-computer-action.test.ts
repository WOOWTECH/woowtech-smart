/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { Monitor } from "lucide-react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { defaultHostAppearance } from "@/hosts/appearance";
import { HostConfirmationDeclinedError } from "@/runtime/woowtech-host-confirmations";
import type { HostProfile } from "@/types/host-connection";
import { useThisComputerWelcomeAction } from "./woowtech-this-computer-action";

// Whether the policy offers the button, and what the probe of this computer does.
const env = vi.hoisted(() => ({
  offer: true,
  probes: [] as unknown[],
  probe: (async () => ({ profile: {}, serverId: "", hostname: null })) as (
    input: unknown,
  ) => Promise<unknown>,
}));

vi.mock("@/runtime/woowtech-localhost-probe-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/runtime/woowtech-localhost-probe-policy")>()),
  shouldOfferThisComputerAction: () => env.offer,
}));

// What the app's toast showed (contexts/toast-context.tsx).
const toast = vi.hoisted(() => {
  const shown: Array<{ content: unknown; options: unknown }> = [];
  const api = {
    show: (content: unknown, options?: unknown) => {
      shown.push({ content, options });
    },
    copied: () => undefined,
    error: (message: string) => {
      shown.push({ content: message, options: { variant: "error" } });
    },
  };
  return { shown, api };
});

vi.mock("@/contexts/toast-context", () => ({ useToast: () => toast.api }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostMutations: () => ({
    probeAndUpsertDirectConnection: (input: unknown) => {
      env.probes.push(input);
      return env.probe(input);
    },
  }),
}));

const PROFILE: HostProfile = {
  serverId: "srv_local",
  label: "mbp",
  appearance: defaultHostAppearance(),
  lifecycle: {},
  connections: [{ id: "direct:localhost:6770", type: "directTcp", endpoint: "localhost:6770" }],
  preferredConnectionId: "direct:localhost:6770",
  createdAt: "2026-10-27T00:00:00.000Z",
  updatedAt: "2026-10-27T00:00:00.000Z",
};

function welcome() {
  const saved: unknown[] = [];
  const view = renderHook(() => useThisComputerWelcomeAction((result) => saved.push(result)));
  return { view, saved };
}

async function press(view: ReturnType<typeof welcome>["view"]): Promise<void> {
  await act(async () => {
    view.result.current?.onPress();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Answers a probe that was left open, as the daemon does once the browser lets the connection through. */
async function answerProbe(finish: (value: unknown) => void): Promise<void> {
  await act(async () => {
    finish({ profile: PROFILE, serverId: "srv_local", hostname: "mbp" });
  });
}

beforeEach(() => {
  env.offer = true;
  env.probes = [];
  env.probe = async () => ({ profile: PROFILE, serverId: "srv_local", hostname: "mbp" });
  toast.shown.length = 0;
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Connect to this computer", () => {
  it("is not offered where the policy says no", () => {
    env.offer = false;
    expect(welcome().view.result.current).toBeNull();
  });

  it("is a welcome action that probes localhost:6770 and saves the host it finds", async () => {
    const { view, saved } = welcome();

    expect(view.result.current).toMatchObject({
      key: "this-computer",
      testID: "welcome-this-computer",
      primary: false,
      icon: Monitor,
      label: "Connect to this computer",
    });
    await press(view);

    // The browser's prompt holds the connection until it is answered, so the wait is 30 s, not the
    // 6 s a direct connection gets (a daemon that is not running still fails at once).
    expect(env.probes).toEqual([{ endpoint: "localhost:6770", connectTimeoutMs: 30_000 }]);
    expect(saved).toEqual([{ profile: PROFILE, serverId: "srv_local" }]);
    expect(toast.shown).toEqual([]);
  });

  it("says nothing when the user says no to the host", async () => {
    env.probe = async () => {
      throw new HostConfirmationDeclinedError();
    };
    const { view, saved } = welcome();

    await press(view);

    expect(saved).toEqual([]);
    expect(toast.shown).toEqual([]);
  });

  it("shows what to do when no daemon answers", async () => {
    env.probe = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:6770");
    };
    const { view, saved } = welcome();

    await press(view);

    expect(saved).toEqual([]);
    expect(toast.shown).toEqual([
      {
        content:
          "No daemon found on this computer\nStart the woowtech smart desktop app or its daemon (localhost:6770), then try again. If your browser asks to access apps and services on this device, choose Allow. If you chose Allow just now, press the button again.",
        options: { variant: "error", durationMs: 10_000, testID: "welcome-this-computer-failed" },
      },
    ]);
  });

  describe("while the browser asks for permission", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("tells the user what the browser is waiting for once the wait gets long", async () => {
      let finish: (value: unknown) => void = () => undefined;
      env.probe = () => new Promise((resolve) => (finish = resolve));
      const { view } = welcome();

      await press(view);
      expect(view.result.current?.label).toBe("Connecting");
      await advance(2_900);
      expect(view.result.current?.label).toBe("Connecting");
      await advance(200);
      expect(view.result.current?.label).toBe("Choose Allow in your browser's prompt…");

      await answerProbe(finish);
      expect(view.result.current?.label).toBe("Connect to this computer");
      // Nothing is left to fire once the connection is done.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("says so in Traditional Chinese", async () => {
      await i18n.changeLanguage("zh-TW");
      env.probe = () => new Promise(() => undefined);
      const { view } = welcome();

      await press(view);
      await advance(3_100);
      expect(view.result.current?.label).toBe("請在瀏覽器的詢問視窗按「允許」…");
    });
  });

  it("shows that it is connecting and ignores more presses until it is done", async () => {
    let finish: (value: unknown) => void = () => undefined;
    env.probe = () => new Promise((resolve) => (finish = resolve));
    const { view, saved } = welcome();

    await press(view);
    expect(view.result.current?.label).toBe("Connecting");
    await press(view);
    expect(env.probes).toHaveLength(1);

    await act(async () => {
      finish({ profile: PROFILE, serverId: "srv_local", hostname: "mbp" });
    });
    expect(saved).toEqual([{ profile: PROFILE, serverId: "srv_local" }]);
    expect(view.result.current?.label).toBe("Connect to this computer");
  });

  it("reads in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(welcome().view.result.current?.label).toBe("連到這台電腦");
  });
});
