import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile, chmod, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createGmailTransport,
  encodeNotification,
  loadGmailCredentials,
} from "./gmail-transport.mjs";

const receipt = "air_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const credentials = {
  GMAIL_CLIENT_ID: "client",
  GMAIL_CLIENT_SECRET: "secret",
  GMAIL_REFRESH_TOKEN: "refresh",
  GMAIL_SENDER: "sender@example.invalid",
  GMAIL_RECIPIENT: "review@example.invalid",
};
function response(status, body) {
  return new Response(JSON.stringify(body), { status });
}

test("OAuth refresh and Gmail raw MIME use only configured addresses, receipt and fixed text", async () => {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1
      ? response(200, { access_token: "token" })
      : response(200, { id: "mail-id" });
  };
  assert.deepEqual(await createGmailTransport({ credentials, request }).send(receipt), {
    status: "sent",
  });
  assert.equal(requests[0].url, "https://oauth2.googleapis.com/token");
  assert.deepEqual(Object.fromEntries(requests[0].options.body), {
    client_id: "client",
    client_secret: "secret",
    refresh_token: "refresh",
    grant_type: "refresh_token",
  });
  assert.equal(requests[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(requests[1].options.headers.authorization, "Bearer token");
  assert.equal(requests[1].options.redirect, "error");
  assert.deepEqual(Object.keys(JSON.parse(requests[1].options.body)), ["raw"]);
  assert.equal(
    Buffer.from(JSON.parse(requests[1].options.body).raw, "base64url").toString(),
    [
      "From: sender@example.invalid",
      "To: review@example.invalid",
      "Subject: woowtech smart: AI content report received",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      "An AI content report was received. Review it in the restricted report queue.",
      `Receipt: ${receipt}`,
      "",
    ].join("\r\n"),
  );
});

test("all dynamic MIME fields reject header injection or multiple recipients", () => {
  assert.throws(() =>
    encodeNotification(
      `${receipt}\r\nBcc: bad@example.invalid`,
      credentials.GMAIL_SENDER,
      credentials.GMAIL_RECIPIENT,
    ),
  );
  for (const address of [
    "x@example.invalid\r\nBcc: bad@example.invalid",
    "a@example.invalid,b@example.invalid",
    "Name <a@example.invalid>",
  ]) {
    assert.throws(() => encodeNotification(receipt, address, credentials.GMAIL_RECIPIENT));
    assert.throws(() => encodeNotification(receipt, credentials.GMAIL_SENDER, address));
  }
});

test("send response classification never retries ambiguous acceptance", async () => {
  for (const [status, expected] of [
    [200, "sent"],
    [400, "blocked"],
    [401, "retry"],
    [403, "blocked"],
    [404, "blocked"],
    [408, "unknown"],
    [429, "unknown"],
    [500, "unknown"],
    [503, "unknown"],
    [302, "unknown"],
  ]) {
    let calls = 0;
    const request = async () =>
      ++calls === 1 ? response(200, { access_token: "token" }) : response(status, { id: "id" });
    assert.deepEqual(await createGmailTransport({ credentials, request }).send(receipt), {
      status: expected,
    });
    assert.equal(calls, 2);
  }
  for (const send of [
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
    async () => {
      throw new Error("network");
    },
    async () => response(200, {}),
    async () => new Response("not-json", { status: 200 }),
  ]) {
    let calls = 0;
    const request = async () => (++calls === 1 ? response(200, { access_token: "token" }) : send());
    assert.deepEqual(await createGmailTransport({ credentials, request }).send(receipt), {
      status: "unknown",
    });
  }
});

test("refresh failure cannot send mail and is bounded by worker retries", async () => {
  for (const [status, expected] of [
    [400, "blocked"],
    [401, "blocked"],
    [429, "retry"],
    [500, "retry"],
  ]) {
    let calls = 0;
    const request = async () => {
      calls++;
      return response(status, { error: "invalid_grant" });
    };
    assert.deepEqual(await createGmailTransport({ credentials, request }).send(receipt), {
      status: expected,
    });
    assert.equal(calls, 1);
  }
  const request = async () => {
    throw new Error("network");
  };
  assert.deepEqual(await createGmailTransport({ credentials, request }).send(receipt), {
    status: "retry",
  });
});

test("credentials come only from a strict private dedicated env, including required recipient", async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "gmail-env-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "gmail.env");
  const text = Object.entries(credentials)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await writeFile(file, text, { mode: 0o600 });
  assert.deepEqual(await loadGmailCredentials(file), credentials);
  for (const invalid of [
    text.replace(/GMAIL_RECIPIENT=.*/, ""),
    `${text}\nGMAIL_RECIPIENT=extra@example.invalid`,
    `${text}\nOTHER=value`,
    text.replace("review@example.invalid", "a@example.invalid,b@example.invalid"),
    text.replace("review@example.invalid", '"review@example.invalid"'),
  ]) {
    await writeFile(file, invalid);
    await assert.rejects(loadGmailCredentials(file));
  }
  await writeFile(file, text);
  await chmod(file, 0o644);
  await assert.rejects(loadGmailCredentials(file), /0600/);
  await chmod(file, 0o600);
  const link = path.join(dir, "link.env");
  await symlink(file, link);
  await assert.rejects(loadGmailCredentials(link), /symlink/);
  await chmod(dir, 0o755);
  await assert.rejects(loadGmailCredentials(file), /0700/);
  await assert.rejects(loadGmailCredentials(undefined), /dedicated/);
});
