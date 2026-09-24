// A minimal ACP agent for tests: it answers `initialize` with the client info it
// received (in the response's _meta) and supports nothing else.
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

function unsupported() {
  throw new Error("not supported by the echo-client-info test agent");
}

new AgentSideConnection(
  () => ({
    async initialize(params) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        _meta: { receivedClientInfo: params.clientInfo ?? null },
      };
    },
    authenticate: unsupported,
    newSession: unsupported,
    prompt: unsupported,
    async cancel() {},
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
