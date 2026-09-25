import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePairingLink, type PairingLinkHandlers } from "./woowtech-pairing-link";

const OFFER = {
  v: 2,
  serverId: "srv_offer",
  daemonPublicKeyB64: "pk_offer",
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const APP_LINK = `woowtech-smart:///#offer=${Buffer.from(JSON.stringify(OFFER)).toString("base64url")}`;

/** OfferLinkListener's side of a link: what it imported, where it went, what it warned. */
function listener(importOffer: PairingLinkHandlers["importOffer"]) {
  const events: string[] = [];
  let cancelled = false;
  const handlers: PairingLinkHandlers = {
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
