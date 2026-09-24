import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export class ClaudeQueryClosedError extends Error {
  constructor(public readonly method: string) {
    super(`Claude query was closed before ${method}() could run`);
    this.name = "ClaudeQueryClosedError";
  }
}

const FINISHED: IteratorReturnResult<void> = { done: true, value: undefined };

/**
 * A Query that exists before the Claude Agent SDK has loaded.
 *
 * The first Claude session after a daemon starts may have to wait for the SDK,
 * which is downloaded on first use (see claude-agent-sdk-runtime.ts), while
 * claudeQuery() has to hand back a Query synchronously. This stands in for the
 * real one: iteration and every control call wait for it. Closing or returning
 * before it exists means it is never created, so no Claude process starts for a
 * session that has already ended.
 *
 * Every Query member is forwarded explicitly so that an SDK upgrade that changes
 * the interface fails to compile here instead of silently dropping a call.
 */
export class DeferredQuery implements Query {
  private real: Query | null = null;
  private closed = false;
  private readonly ready: Promise<Query | null>;

  /** @param pending resolves to a function that creates the real Query. */
  constructor(pending: Promise<() => Query>) {
    this.ready = pending.then((create) => {
      if (this.closed) {
        return null;
      }
      this.real = create();
      return this.real;
    });
    // A failed load is reported through iteration; don't also raise an unhandled rejection.
    this.ready.catch(() => {});
  }

  private async forward<T>(method: string, call: (query: Query) => Promise<T>): Promise<T> {
    const query = await this.ready;
    if (!query) {
      throw new ClaudeQueryClosedError(method);
    }
    return call(query);
  }

  // --- AsyncGenerator -------------------------------------------------------

  async next(...args: [] | [unknown]): Promise<IteratorResult<SDKMessage, void>> {
    const query = await this.ready;
    return query ? query.next(...args) : FINISHED;
  }

  async return(value: void | PromiseLike<void>): Promise<IteratorResult<SDKMessage, void>> {
    if (this.real) {
      return this.real.return(value);
    }
    this.closed = true;
    const query = await this.ready.catch(() => null);
    return query ? query.return(value) : FINISHED;
  }

  async throw(error: unknown): Promise<IteratorResult<SDKMessage, void>> {
    const query = await this.ready;
    if (!query) {
      throw error;
    }
    return query.throw(error);
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.return(undefined);
  }

  close(): void {
    this.closed = true;
    this.real?.close();
  }

  // --- Control calls ----------------------------------------------------------

  interrupt(...args: Parameters<Query["interrupt"]>): ReturnType<Query["interrupt"]> {
    return this.forward("interrupt", (query) => query.interrupt(...args));
  }

  setPermissionMode(
    ...args: Parameters<Query["setPermissionMode"]>
  ): ReturnType<Query["setPermissionMode"]> {
    return this.forward("setPermissionMode", (query) => query.setPermissionMode(...args));
  }

  setMcpPermissionModeOverride(
    ...args: Parameters<Query["setMcpPermissionModeOverride"]>
  ): ReturnType<Query["setMcpPermissionModeOverride"]> {
    return this.forward("setMcpPermissionModeOverride", (query) =>
      query.setMcpPermissionModeOverride(...args),
    );
  }

  setModel(...args: Parameters<Query["setModel"]>): ReturnType<Query["setModel"]> {
    return this.forward("setModel", (query) => query.setModel(...args));
  }

  setMaxThinkingTokens(
    ...args: Parameters<Query["setMaxThinkingTokens"]>
  ): ReturnType<Query["setMaxThinkingTokens"]> {
    return this.forward("setMaxThinkingTokens", (query) => query.setMaxThinkingTokens(...args));
  }

  applyFlagSettings(
    ...args: Parameters<Query["applyFlagSettings"]>
  ): ReturnType<Query["applyFlagSettings"]> {
    return this.forward("applyFlagSettings", (query) => query.applyFlagSettings(...args));
  }

  initializationResult(): ReturnType<Query["initializationResult"]> {
    return this.forward("initializationResult", (query) => query.initializationResult());
  }

  reinitialize(): ReturnType<Query["reinitialize"]> {
    return this.forward("reinitialize", (query) => query.reinitialize());
  }

  supportedCommands(): ReturnType<Query["supportedCommands"]> {
    return this.forward("supportedCommands", (query) => query.supportedCommands());
  }

  supportedModels(): ReturnType<Query["supportedModels"]> {
    return this.forward("supportedModels", (query) => query.supportedModels());
  }

  supportedAgents(): ReturnType<Query["supportedAgents"]> {
    return this.forward("supportedAgents", (query) => query.supportedAgents());
  }

  mcpServerStatus(): ReturnType<Query["mcpServerStatus"]> {
    return this.forward("mcpServerStatus", (query) => query.mcpServerStatus());
  }

  getContextUsage(): ReturnType<Query["getContextUsage"]> {
    return this.forward("getContextUsage", (query) => query.getContextUsage());
  }

  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): ReturnType<
    Query["usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"]
  > {
    return this.forward("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET", (query) =>
      query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
    );
  }

  readFile(...args: Parameters<Query["readFile"]>): ReturnType<Query["readFile"]> {
    return this.forward("readFile", (query) => query.readFile(...args));
  }

  reloadPlugins(): ReturnType<Query["reloadPlugins"]> {
    return this.forward("reloadPlugins", (query) => query.reloadPlugins());
  }

  reloadSkills(): ReturnType<Query["reloadSkills"]> {
    return this.forward("reloadSkills", (query) => query.reloadSkills());
  }

  accountInfo(): ReturnType<Query["accountInfo"]> {
    return this.forward("accountInfo", (query) => query.accountInfo());
  }

  rewindFiles(...args: Parameters<Query["rewindFiles"]>): ReturnType<Query["rewindFiles"]> {
    return this.forward("rewindFiles", (query) => query.rewindFiles(...args));
  }

  seedReadState(...args: Parameters<Query["seedReadState"]>): ReturnType<Query["seedReadState"]> {
    return this.forward("seedReadState", (query) => query.seedReadState(...args));
  }

  reconnectMcpServer(
    ...args: Parameters<Query["reconnectMcpServer"]>
  ): ReturnType<Query["reconnectMcpServer"]> {
    return this.forward("reconnectMcpServer", (query) => query.reconnectMcpServer(...args));
  }

  toggleMcpServer(
    ...args: Parameters<Query["toggleMcpServer"]>
  ): ReturnType<Query["toggleMcpServer"]> {
    return this.forward("toggleMcpServer", (query) => query.toggleMcpServer(...args));
  }

  setMcpServers(...args: Parameters<Query["setMcpServers"]>): ReturnType<Query["setMcpServers"]> {
    return this.forward("setMcpServers", (query) => query.setMcpServers(...args));
  }

  streamInput(...args: Parameters<Query["streamInput"]>): ReturnType<Query["streamInput"]> {
    return this.forward("streamInput", (query) => query.streamInput(...args));
  }

  stopTask(...args: Parameters<Query["stopTask"]>): ReturnType<Query["stopTask"]> {
    return this.forward("stopTask", (query) => query.stopTask(...args));
  }

  backgroundTasks(
    ...args: Parameters<Query["backgroundTasks"]>
  ): ReturnType<Query["backgroundTasks"]> {
    return this.forward("backgroundTasks", (query) => query.backgroundTasks(...args));
  }
}
