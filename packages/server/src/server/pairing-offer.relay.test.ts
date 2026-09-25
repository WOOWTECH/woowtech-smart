import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import { afterEach, expect, test } from "vitest";

import { generateLocalPairingOffer } from "./pairing-offer.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// woowtech smart: an offer that names no relay sends the phone to WoowTech's relay.
test("a pairing offer without a relay endpoint points at WoowTech's relay over TLS", async () => {
  const paseoHome = await mkdtemp(path.join(os.tmpdir(), "woowtech-pairing-offer-"));
  roots.push(paseoHome);

  const pairing = await generateLocalPairingOffer({ paseoHome, includeQr: false });

  expect(pairing.relayEnabled).toBe(true);
  expect(parseConnectionOfferFromUrl(pairing.url ?? "")?.relay).toEqual({
    endpoint: "relay.woowtech.io:443",
    useTls: true,
  });
});
