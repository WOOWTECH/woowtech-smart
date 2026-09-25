import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLocalPairingOffer } from "./pair.js";

/** The part of a pairing link before its `#offer=` fragment. */
function linkBase(link: string | null): string | null {
  const index = link?.indexOf("#offer=") ?? -1;
  return link && index !== -1 ? link.slice(0, index) : null;
}

// woowtech smart's pairing links open the app itself (woowtech-smart:///#offer=…),
// also in homes whose config.json still has upstream's default app.baseUrl.
describe("the link daemon pair prints", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "woowtech-pair-app-link-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("opens the app for a new home", async () => {
    const offer = await resolveLocalPairingOffer({ paseoHome: path.join(root, "home") });

    expect(linkBase(offer.url)).toBe("woowtech-smart:///");
    expect(parseConnectionOfferFromUrl(offer.url ?? "")?.relay.endpoint).toBe(
      "relay.woowtech.io:443",
    );
  });

  it("opens the app for a home created with upstream's default", async () => {
    const home = path.join(root, "home");
    await mkdir(home);
    await writeFile(
      path.join(home, "config.json"),
      JSON.stringify({ version: 1, app: { baseUrl: "https://app.paseo.sh" } }),
    );

    const offer = await resolveLocalPairingOffer({ paseoHome: home });

    expect(linkBase(offer.url)).toBe("woowtech-smart:///");
  });
});
