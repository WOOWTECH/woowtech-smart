import { afterEach, describe, expect, it, vi } from "vitest";
import { HostRuntimeStore, type HostRuntimeControllerDeps } from "./host-runtime";
import {
  handlePairingLink,
  type HostRegistry,
  type PairingLinkHandlers,
} from "./woowtech-pairing-link";

const OFFER = {
  v: 2,
  serverId: "srv_offer",
  daemonPublicKeyB64: "pk_offer",
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const APP_LINK = `woowtech-smart:///#offer=${Buffer.from(JSON.stringify(OFFER)).toString("base64url")}`;

// A host store that has loaded the saved hosts, as it has once the app is up.
const LOADED_HOSTS: HostRegistry = {
  isHostRegistryLoaded: () => true,
  subscribeHostList: () => () => undefined,
};

/** OfferLinkListener's side of a link: what it imported, where it went, what it warned. */
function listener(importOffer: PairingLinkHandlers["importOffer"]) {
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
  };
  return {
    handlers,
    events,
    cancel() {
      cancelled = true;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a link the app is opened with", () => {
  it("saves the host of a woowtech-smart:///#offer= link, then opens 'open project'", async () => {
    const app = listener(async () => ({ serverId: "srv_offer" }));

    await handlePairingLink(APP_LINK, app.handlers);

    expect(app.events).toEqual([`import ${APP_LINK}`, "open project"]);
  });

  it("pairs from an https link with an offer too, such as a daemon's own web app", async () => {
    const app = listener(async () => ({ serverId: "srv_offer" }));
    const webLink = `https://192.168.1.20:6770/#offer=${APP_LINK.split("#offer=")[1]}`;

    await handlePairingLink(webLink, app.handlers);

    expect(app.events).toEqual([`import ${webLink}`, "open project"]);
  });

  it("leaves links without an offer to Expo Router", async () => {
    const app = listener(async () => ({ serverId: "srv_offer" }));

    for (const link of [null, "woowtech-smart:///", "woowtech-smart:///h/srv_offer/workspace"]) {
      await handlePairingLink(link, app.handlers);
    }

    expect(app.events).toEqual([]);
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
    const app = listener(async () => ({ serverId: "srv_offer" }));

    await handlePairingLink(APP_LINK, app.handlers);

    expect(linksGivenToUrl).toEqual([]);
    expect(app.events).toEqual([`import ${APP_LINK}`, "open project"]);
  });

  it("stays where it is and says so when the offer cannot be saved", async () => {
    const app = listener(async () => {
      throw new Error("Offer payload is empty");
    });

    await handlePairingLink(APP_LINK, app.handlers);

    expect(app.events).toEqual([
      `import ${APP_LINK}`,
      "warn [Linking] Failed to import pairing offer",
    ]);
  });

  it("saves the host but goes nowhere once the listener has gone", async () => {
    let finishImport: (profile: unknown) => void = () => undefined;
    const app = listener(() => new Promise((resolve) => (finishImport = resolve)));

    const handled = handlePairingLink(APP_LINK, app.handlers);
    await Promise.resolve();
    app.cancel();
    finishImport({ serverId: "srv_offer" });
    await handled;

    expect(app.events).toEqual([`import ${APP_LINK}`]);
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
      daemonPublicKeyB64: "pk_saved",
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
    const handled = Promise.resolve(APP_LINK).then((url) =>
      handlePairingLink(url, { ...app.handlers, hosts: hosts.store }),
    );
    const booted = hosts.store.boot();
    await Promise.all([handled, booted]);
    await settle();

    expect({ inMemory: hosts.inMemory(), saved: hosts.saved() }).toEqual({
      inMemory: ["srv_saved", "srv_offer"],
      saved: ["srv_saved", "srv_offer"],
    });
    expect(app.events).toEqual([`import ${APP_LINK}`, "open project"]);
    hosts.store.syncHosts([]);
  });

  it("pairs at once when the saved hosts have loaded", async () => {
    const hosts = storeWithSavedHosts([SAVED_HOST]);
    await hosts.store.boot();
    const app = listener((url) => hosts.store.upsertConnectionFromOfferUrl(url));

    await handlePairingLink(APP_LINK, { ...app.handlers, hosts: hosts.store });
    await settle();

    expect({ inMemory: hosts.inMemory(), saved: hosts.saved() }).toEqual({
      inMemory: ["srv_saved", "srv_offer"],
      saved: ["srv_saved", "srv_offer"],
    });
    hosts.store.syncHosts([]);
  });
});
