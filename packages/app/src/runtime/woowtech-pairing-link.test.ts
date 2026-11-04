import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRuntimeStore, type HostRuntimeControllerDeps } from "./host-runtime";
import { HostConfirmations, hostConfirmations } from "./woowtech-host-confirmations";
import { confirmPairingLink, type PairingHostRegistry } from "./woowtech-pairing-confirmation";
import {
  handlePairingLink,
  resetPairingLinksForTests,
  type PairingLinkHandlers,
} from "./woowtech-pairing-link";

const OFFER = {
  v: 2,
  serverId: "srv_offer",
  // A daemon key: 32 bytes of standard base64 (relay/src/crypto.ts).
  daemonPublicKeyB64: Buffer.alloc(32, 5).toString("base64"),
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const PAYLOAD = Buffer.from(JSON.stringify(OFFER)).toString("base64url");
// Pairing links and QR codes open the web app; daemons and QR codes from before 2026-10-27 open
// the app through its own scheme.
const WEB_LINK = `https://web.example.test/#offer=${PAYLOAD}`;
const LEGACY_APP_LINK = `woowtech-smart:///#offer=${PAYLOAD}`;

// A host store that has loaded the saved hosts, as it has once the app is up.
const LOADED_HOSTS: PairingHostRegistry = {
  isHostRegistryLoaded: () => true,
  subscribeHostList: () => () => undefined,
  getHosts: () => [],
  getSnapshot: () => null,
};

interface ListenerOptions {
  confirm?: PairingLinkHandlers["confirm"];
  rememberHandled?: boolean;
}

/** OfferLinkListener's side of a link: what it cleared, asked, imported, opened and warned. */
function listener(importOffer: PairingLinkHandlers["importOffer"], options: ListenerOptions = {}) {
  const events: string[] = [];
  let cancelled = false;
  const handlers: PairingLinkHandlers = {
    hosts: LOADED_HOSTS,
    importOffer: async (url) => {
      events.push(`import ${url}`);
      return importOffer(url);
    },
    openProject: () => events.push("open project"),
    isCancelled: () => cancelled,
    warn: (message) => events.push(`warn ${message}`),
    clearLink: () => events.push("clear"),
    confirm: async (url, hosts) => {
      events.push(`confirm ${url}`);
      return options.confirm ? options.confirm(url, hosts) : true;
    },
    rememberHandled: options.rememberHandled ?? false,
  };
  return {
    handlers,
    events,
    cancel() {
      cancelled = true;
    },
  };
}

const imported = async () => ({ serverId: "srv_offer" });

/** A confirm that asks a real HostConfirmations, and the questions it put to the user. */
function askingConfirm() {
  const confirmations = new HostConfirmations();
  const asked: string[] = [];
  confirmations.subscribe(() => {
    const pending = confirmations.getPending();
    if (pending) asked.push(pending.kind);
  });
  const confirm: NonNullable<PairingLinkHandlers["confirm"]> = (url, hosts) =>
    confirmPairingLink(url, { hosts, confirmations });
  return { confirmations, asked, confirm };
}

beforeEach(() => {
  resetPairingLinksForTests();
  hostConfirmations.resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a link the app is opened with", () => {
  it("clears the address bar, asks, saves the host of a web app link, then opens 'open project'", async () => {
    const app = listener(imported);

    await handlePairingLink(WEB_LINK, app.handlers);

    expect(app.events).toEqual([
      "clear",
      `confirm ${WEB_LINK}`,
      `import ${WEB_LINK}`,
      "open project",
    ]);
  });

  it("pairs from the app's own scheme the same way, for old daemons and QR codes", async () => {
    const app = listener(imported);

    await handlePairingLink(LEGACY_APP_LINK, app.handlers);

    expect(app.events).toEqual([
      "clear",
      `confirm ${LEGACY_APP_LINK}`,
      `import ${LEGACY_APP_LINK}`,
      "open project",
    ]);
  });

  it("asks about a link with a query before its offer", async () => {
    const link = `https://web.example.test/?a=1#offer=${PAYLOAD}`;
    const app = listener(imported);

    await handlePairingLink(link, app.handlers);

    expect(app.events).toEqual(["clear", `confirm ${link}`, `import ${link}`, "open project"]);
  });

  it("saves nothing and goes nowhere when the user says no", async () => {
    const app = listener(imported, { confirm: async () => false });

    await handlePairingLink(WEB_LINK, app.handlers);

    expect(app.events).toEqual(["clear", `confirm ${WEB_LINK}`]);
  });

  it("leaves links without an offer to Expo Router", async () => {
    const app = listener(imported);

    for (const link of [
      null,
      "woowtech-smart:///",
      "https://web.example.test/h/srv_offer/workspace",
    ]) {
      await handlePairingLink(link, app.handlers);
    }

    expect(app.events).toEqual([]);
  });

  it("clears but never asks about or imports offer= elsewhere in the fragment", async () => {
    const app = listener(imported);

    await handlePairingLink(`https://web.example.test/#x#offer=${PAYLOAD}`, app.handlers);

    expect(app.events).toEqual([
      "clear",
      "warn [Linking] Ignored a link whose fragment does not start with offer=",
    ]);
    expect(app.events.join("\n")).not.toContain(PAYLOAD);
  });

  it("warns without asking when the offer cannot be read", async () => {
    const asking = askingConfirm();
    const app = listener(imported, { confirm: asking.confirm });
    const broken = [
      `https://web.example.test/#offer=${PAYLOAD}&y`,
      `https://web.example.test/#offer=${Buffer.from("{}").toString("base64url")}`,
      `https://web.example.test/#offer=${Buffer.from(JSON.stringify({ ...OFFER, daemonPublicKeyB64: "synthetic-key" })).toString("base64url")}`,
    ];

    for (const link of broken) await handlePairingLink(link, app.handlers);

    expect(asking.asked).toEqual([]);
    expect(app.events.filter((event) => event.startsWith("import"))).toEqual([]);
    expect(app.events.filter((event) => event.startsWith("warn"))).toEqual(
      broken.map(() => "warn [Linking] Failed to import pairing offer"),
    );
  });

  it("asks the app's confirmation store unless told otherwise", async () => {
    const app = listener(imported);

    const handled = handlePairingLink(WEB_LINK, { ...app.handlers, confirm: undefined });
    await vi.waitFor(() =>
      expect(hostConfirmations.getPending()).toMatchObject({
        kind: "newHost",
        serverId: "srv_offer",
      }),
    );
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, true);
    await handled;

    expect(app.events).toEqual(["clear", `import ${WEB_LINK}`, "open project"]);
  });

  it("never hands the link to React Native's URL class", async () => {
    const linksGivenToUrl: string[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        constructor(input: string | URL, base?: string | URL) {
          super(input, base);
          linksGivenToUrl.push(String(input));
        }
      },
    );
    const asking = askingConfirm();
    const app = listener(imported, { confirm: asking.confirm });

    const handled = handlePairingLink(LEGACY_APP_LINK, app.handlers);
    await vi.waitFor(() => expect(asking.confirmations.getPending()).not.toBeNull());
    asking.confirmations.answer(asking.confirmations.getPending()?.id ?? -1, true);
    await handled;

    expect(linksGivenToUrl).toEqual([]);
    expect(app.events.slice(-2)).toEqual([`import ${LEGACY_APP_LINK}`, "open project"]);
  });

  it("stays where it is and says so when the offer cannot be saved", async () => {
    const app = listener(async () => {
      throw new Error("Offer payload is empty");
    });

    await handlePairingLink(WEB_LINK, app.handlers);

    expect(app.events).toEqual([
      "clear",
      `confirm ${WEB_LINK}`,
      `import ${WEB_LINK}`,
      "warn [Linking] Failed to import pairing offer",
    ]);
  });

  it("saves the host but goes nowhere once the listener has gone", async () => {
    let finishImport: (profile: unknown) => void = () => undefined;
    const app = listener(() => new Promise((resolve) => (finishImport = resolve)));

    const handled = handlePairingLink(WEB_LINK, app.handlers);
    await vi.waitFor(() => expect(app.events).toContain(`import ${WEB_LINK}`));
    app.cancel();
    finishImport({ serverId: "srv_offer" });
    await handled;

    expect(app.events).toEqual(["clear", `confirm ${WEB_LINK}`, `import ${WEB_LINK}`]);
  });

  it("saves an approved host but goes nowhere when the listener went while it asked", async () => {
    let approve: (approved: boolean) => void = () => undefined;
    const app = listener(imported, {
      confirm: () => new Promise((resolve) => (approve = resolve)),
    });

    const handled = handlePairingLink(WEB_LINK, app.handlers);
    await vi.waitFor(() => expect(app.events).toContain(`confirm ${WEB_LINK}`));
    app.cancel();
    approve(true);
    await handled;

    expect(app.events).toEqual(["clear", `confirm ${WEB_LINK}`, `import ${WEB_LINK}`]);
  });

  it("handles a link once while it is still being handled", async () => {
    let approve: (approved: boolean) => void = () => undefined;
    const app = listener(imported, {
      confirm: () => new Promise((resolve) => (approve = resolve)),
    });

    const first = handlePairingLink(WEB_LINK, app.handlers);
    const again = handlePairingLink(WEB_LINK, app.handlers);
    await again;
    approve(true);
    await first;

    expect(app.events.filter((event) => event.startsWith("confirm"))).toHaveLength(1);
    expect(app.events.filter((event) => event.startsWith("import"))).toHaveLength(1);
  });
});

describe("the same link again", () => {
  it("is never asked about again on the web, where every message event reports it", async () => {
    const declined = listener(imported, { confirm: async () => false, rememberHandled: true });
    await handlePairingLink(WEB_LINK, declined.handlers);
    for (let report = 0; report < 10; report += 1) {
      await handlePairingLink(WEB_LINK, declined.handlers);
    }
    expect(declined.events.filter((event) => event.startsWith("confirm"))).toHaveLength(1);

    resetPairingLinksForTests();
    const approved = listener(imported, { rememberHandled: true });
    await handlePairingLink(WEB_LINK, approved.handlers);
    await handlePairingLink(WEB_LINK, approved.handlers);
    expect(approved.events.filter((event) => event === "open project")).toHaveLength(1);
  });

  it("is asked about again on a phone, which sends it only when the user opens it again", async () => {
    const app = listener(imported, { confirm: async () => false, rememberHandled: false });

    await handlePairingLink(LEGACY_APP_LINK, app.handlers);
    await handlePairingLink(LEGACY_APP_LINK, app.handlers);

    expect(app.events.filter((event) => event.startsWith("confirm"))).toHaveLength(2);
  });
});

const REGISTRY_KEY = "@paseo:daemon-registry";

const SAVED_HOST = {
  serverId: "srv_saved",
  label: "Studio Mac",
  connections: [
    {
      id: "relay:wss:relay.woowtech.io:443",
      type: "relay",
      relayEndpoint: "relay.woowtech.io:443",
      useTls: true,
      daemonPublicKeyB64: Buffer.alloc(32, 6).toString("base64"),
    },
  ],
  preferredConnectionId: "relay:wss:relay.woowtech.io:443",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

// No daemon answers in these tests; the hosts are only saved.
const NO_DAEMONS: HostRuntimeControllerDeps = {
  createClient: () => {
    throw new Error("no daemon connections in this test");
  },
  connectToDaemon: async () => {
    throw new Error("no daemon connections in this test");
  },
  getClientId: async () => "cid_pairing_link",
};

/** A host store over in-memory storage that already holds `hosts`. */
function storeWithSavedHosts(hosts: unknown[]) {
  const values = new Map<string, string>([
    [REGISTRY_KEY, JSON.stringify(hosts)],
    // Ends the boot after the saved hosts load, before it probes localhost for a daemon.
    ["@paseo:e2e", "1"],
  ]);
  const store = new HostRuntimeStore({
    deps: NO_DAEMONS,
    storage: {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    },
  });
  return {
    store,
    inMemory: () => store.getHosts().map((host) => host.serverId),
    saved: () =>
      (JSON.parse(values.get(REGISTRY_KEY) ?? "[]") as { serverId: string }[]).map(
        (host) => host.serverId,
      ),
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("a pairing link that starts the app", () => {
  it("keeps the saved hosts when the link arrives before they load", async () => {
    const hosts = storeWithSavedHosts([SAVED_HOST]);
    const app = listener((url) => hosts.store.upsertConnectionFromOfferUrl(url));

    // A cold start through the camera: React runs OfferLinkListener's effect (a child's) before
    // HostRuntimeBootstrapProvider's, so Linking.getInitialURL() is asked before the store boots.
    const handled = Promise.resolve(WEB_LINK).then((url) =>
      handlePairingLink(url, { ...app.handlers, hosts: hosts.store }),
    );
    const booted = hosts.store.boot();
    await Promise.all([handled, booted]);
    await settle();

    expect({ inMemory: hosts.inMemory(), saved: hosts.saved() }).toEqual({
      inMemory: ["srv_saved", "srv_offer"],
      saved: ["srv_saved", "srv_offer"],
    });
    expect(app.events).toEqual([
      "clear",
      `confirm ${WEB_LINK}`,
      `import ${WEB_LINK}`,
      "open project",
    ]);
    hosts.store.syncHosts([]);
  });

  it("pairs at once when the saved hosts have loaded", async () => {
    const hosts = storeWithSavedHosts([SAVED_HOST]);
    await hosts.store.boot();
    const app = listener((url) => hosts.store.upsertConnectionFromOfferUrl(url));

    await handlePairingLink(WEB_LINK, { ...app.handlers, hosts: hosts.store });
    await settle();

    expect({ inMemory: hosts.inMemory(), saved: hosts.saved() }).toEqual({
      inMemory: ["srv_saved", "srv_offer"],
      saved: ["srv_saved", "srv_offer"],
    });
    hosts.store.syncHosts([]);
  });
});
