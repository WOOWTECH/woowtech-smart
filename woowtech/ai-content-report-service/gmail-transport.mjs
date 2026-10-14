import path from "node:path";
import { RECEIPT, privateDirectory, readPrivate } from "./notification-storage.mjs";

const KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_SENDER",
  "GMAIL_RECIPIENT",
];
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export async function loadGmailCredentials(file) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new Error("dedicated Gmail env path required");
  await privateDirectory(path.dirname(file));
  const { text } = await readPrivate(file);
  const values = {};
  // Deliberately not a shell or general dotenv parser: no interpolation, export or multiline values.
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const match = /^([A-Z_]+)=([^\s"'\\]+)$/.exec(line);
    if (!match || !KEYS.includes(match[1]) || Object.hasOwn(values, match[1]))
      throw new Error("invalid dedicated Gmail env");
    values[match[1]] = match[2];
  }
  if (
    KEYS.some((key) => !values[key]) ||
    !ADDRESS.test(values.GMAIL_SENDER) ||
    !ADDRESS.test(values.GMAIL_RECIPIENT)
  )
    throw new Error("incomplete dedicated Gmail env");
  return values;
}

export function encodeNotification(receipt, sender, recipient) {
  if (!RECEIPT.test(receipt) || !ADDRESS.test(sender) || !ADDRESS.test(recipient))
    throw new Error("invalid mail metadata");
  const message = [
    `From: ${sender}`,
    `To: ${recipient}`,
    "Subject: woowtech smart: AI content report received",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    "An AI content report was received. Review it in the restricted report queue.",
    `Receipt: ${receipt}`,
    "",
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

export function createGmailTransport({ credentials, request = fetch, timeoutMs = 15_000 }) {
  return {
    async send(receipt) {
      const raw = encodeNotification(
        receipt,
        credentials.GMAIL_SENDER,
        credentials.GMAIL_RECIPIENT,
      );
      let tokenResponse;
      let token;
      try {
        tokenResponse = await request("https://oauth2.googleapis.com/token", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: credentials.GMAIL_CLIENT_ID,
            client_secret: credentials.GMAIL_CLIENT_SECRET,
            refresh_token: credentials.GMAIL_REFRESH_TOKEN,
            grant_type: "refresh_token",
          }),
        });
        if (!tokenResponse.ok) {
          const transient = tokenResponse.status === 429 || tokenResponse.status >= 500;
          return { status: transient ? "retry" : "blocked" };
        }
        token = await tokenResponse.json();
      } catch {
        // No send request has begun, so retrying refresh cannot duplicate a notification.
        return { status: "retry" };
      }
      if (
        !token ||
        typeof token.access_token !== "string" ||
        !/^[A-Za-z0-9._~+/-]+=*$/.test(token.access_token)
      )
        return { status: "blocked" };
      try {
        const response = await request(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              authorization: `Bearer ${token.access_token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ raw }),
          },
        );
        if (response.ok) {
          const message = await response.json();
          return {
            status: typeof message.id === "string" && message.id.length > 0 ? "sent" : "unknown",
          };
        }
        if (response.status === 401) return { status: "retry" };
        if (response.status === 400 || response.status === 403 || response.status === 404)
          return { status: "blocked" };
        // Gmail send quotas can surface late. 429, 5xx and ambiguous responses are not proof of rejection.
        return { status: "unknown" };
      } catch {
        return { status: "unknown" };
      }
    },
  };
}
