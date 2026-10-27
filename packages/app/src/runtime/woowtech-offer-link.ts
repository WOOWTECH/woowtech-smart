import {
  ConnectionOfferSchema,
  decodeOfferFragmentPayload,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";
import { parseHostPort } from "@getpaseo/protocol/daemon-endpoints";

// woowtech smart (fork-owned; woowtech/README.md, 19): the one definition of a pairing link that
// the link listener, the scanner, the paste field and the desktop fingerprint share, and the
// checks an offer passes before anything about it is shown or saved. Error messages never
// carry the link: the offer in it is a credential.

export class PairingOfferError extends Error {
  override name = "PairingOfferError";
}

const OFFER_FRAGMENT_START = "offer=";

/** The fragment: everything after the link's first "#", or null without one. */
function fragmentOf(link: string): string | null {
  const hashIndex = link.indexOf("#");
  return hashIndex === -1 ? null : link.slice(hashIndex + 1);
}

/** The base64url payload when the fragment (from the link's first "#") starts with "offer="; otherwise null. */
export function offerPayloadFromLink(link: string): string | null {
  const fragment = fragmentOf(link.trim());
  if (fragment === null || !fragment.startsWith(OFFER_FRAGMENT_START)) return null;
  const payload = fragment.slice(OFFER_FRAGMENT_START.length).trim();
  return payload.length > 0 ? payload : null;
}

/** Whether the fragment carries "offer=" anywhere. Only used to scrub the address bar, never to import. */
export function linkMentionsOffer(link: string): boolean {
  return fragmentOf(link)?.includes(OFFER_FRAGMENT_START) ?? false;
}

/** offerPayloadFromLink → decodeOfferFragmentPayload → ConnectionOfferSchema.parse → validatePairingOffer. */
export function readPairingOffer(link: string): ConnectionOffer {
  const payload = offerPayloadFromLink(link);
  if (payload === null) {
    throw new PairingOfferError(
      "Not a pairing link: the part after its first # must start with offer=",
    );
  }
  let offer: ConnectionOffer;
  try {
    offer = ConnectionOfferSchema.parse(decodeOfferFragmentPayload(payload));
  } catch (error) {
    throw new PairingOfferError("Invalid pairing offer", { cause: error });
  }
  validatePairingOffer(offer);
  return offer;
}

// Daemons hand out "srv_" and 12 base64url characters (server/server-id.ts); PASEO_SERVER_ID and
// tests set others, so this allows any short id that prints plainly.
const SERVER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64_TEXT = /^[A-Za-z0-9+/_-]+={0,2}$/;
const DAEMON_KEY_BYTES = 32;
const HOST_NAME = /^[A-Za-z0-9.-]{1,253}$/;
const IPV6_ADDRESS = /^[0-9A-Fa-f:.]+$/;

/** The number of bytes base64 or base64url text decodes to, or null when it is not such text. */
function base64ByteLength(text: string): number | null {
  if (!BASE64_TEXT.test(text)) return null;
  const unpadded = text.replace(/=+$/, "");
  const padded = unpadded.length !== text.length;
  if (unpadded.length % 4 === 1 || (padded && text.length % 4 !== 0)) return null;
  return Math.floor((unpadded.length * 3) / 4);
}

function isPlainRelayEndpoint(endpoint: string): boolean {
  const trimmed = endpoint.trim();
  if (/\s/.test(trimmed)) return false;
  try {
    const { host, isIpv6 } = parseHostPort(trimmed);
    return isIpv6 ? IPV6_ADDRESS.test(host) : HOST_NAME.test(host);
  } catch {
    return false;
  }
}

/** What the schema lets through but the confirmation sheet cannot show or the relay cannot use. */
export function validatePairingOffer(offer: ConnectionOffer): void {
  if (!SERVER_ID.test(offer.serverId)) {
    throw new PairingOfferError(
      "Invalid pairing offer: the server id is not 1-64 letters, digits, _ or -",
    );
  }
  // A nacl box public key (relay/src/crypto.ts).
  if (base64ByteLength(offer.daemonPublicKeyB64.trim()) !== DAEMON_KEY_BYTES) {
    throw new PairingOfferError("Invalid pairing offer: the daemon key is not 32 bytes of base64");
  }
  if (!isPlainRelayEndpoint(offer.relay.endpoint)) {
    throw new PairingOfferError("Invalid pairing offer: the relay is not host:port");
  }
}

/**
 * Shows the key material itself (not a re-hash) in groups of four. Keys longer than 16
 * characters show only their first and last 8, so two keys that share both ends show the same
 * value. Upstream's algorithm (364e6456e, runtime/host-confirmation.ts).
 */
export function formatDaemonKeyFingerprint(daemonPublicKeyB64: string): string {
  const normalized = daemonPublicKeyB64.replace(/[^A-Za-z0-9]/g, "");
  const group = (value: string): string => value.replace(/(.{4})/g, "$1 ").trim();
  if (normalized.length <= 16) return group(normalized);
  return `${group(normalized.slice(0, 8))} … ${group(normalized.slice(-8))}`;
}

// Line breaks and tabs become spaces. C0 and C1 controls, the Arabic letter mark, zero-width
// and bidi marks, embeddings, overrides and isolates, the word joiner and the BOM go.
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

function isInvisible(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return INVISIBLE_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);
}

/** One line for the sheet: no C0/C1 controls, no bidi or zero-width marks, at most maxLength characters. */
export function displayText(value: string, maxLength = 80): string {
  const visible = Array.from(value.replace(LINE_BREAKS, " "))
    .filter((character) => !isInvisible(character))
    .join("");
  const oneLine = visible.replace(/\s+/g, " ").trim();
  const characters = Array.from(oneLine);
  if (characters.length <= maxLength) return oneLine;
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}
