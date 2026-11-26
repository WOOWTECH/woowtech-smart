import { describe, expect, it } from "vitest";
import { createMermaidRuntimeWebLoader, type MermaidRuntimeHtmlResult } from "./runtime-loader.web";

function deferredHtml() {
  let resolve!: (html: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("Mermaid web runtime loading", () => {
  it("loads on demand and shares pending and successful loads across frames", async () => {
    const html = deferredHtml();
    let imports = 0;
    const load = createMermaidRuntimeWebLoader(() => {
      imports += 1;
      return html.promise;
    });
    expect(imports).toBe(0);

    const preview = new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));
    const fullscreen = new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));
    expect(imports).toBe(1);
    html.resolve("<html>runtime</html>");
    const ready = { status: "ready", html: "<html>runtime</html>" };
    expect(await preview).toEqual(ready);
    expect(await fullscreen).toEqual(ready);
    expect(await new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve))).toEqual(ready);
    expect(imports).toBe(1);
  });

  it("ignores disposed subscribers while a remounted frame still receives the HTML", async () => {
    const html = deferredHtml();
    const load = createMermaidRuntimeWebLoader(() => html.promise);
    const disposedResults: MermaidRuntimeHtmlResult[] = [];
    const dispose = load((result) => disposedResults.push(result));
    dispose();
    const remounted = new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));

    html.resolve("<html>runtime</html>");
    expect(await remounted).toEqual({ status: "ready", html: "<html>runtime</html>" });
    expect(disposedResults).toEqual([]);
  });

  it("reports a failed download only to mounted frames and retries on a later mount", async () => {
    const first = deferredHtml();
    const retry = deferredHtml();
    let imports = 0;
    const load = createMermaidRuntimeWebLoader(() => {
      imports += 1;
      return imports === 1 ? first.promise : retry.promise;
    });
    const disposedResults: MermaidRuntimeHtmlResult[] = [];
    const dispose = load((result) => disposedResults.push(result));
    const mounted = new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));
    dispose();

    first.reject(new Error("Chunk download failed"));
    expect(await mounted).toEqual({ status: "failed" });
    expect(disposedResults).toEqual([]);

    const remounted = new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));
    expect(imports).toBe(2);
    retry.resolve("<html>retry</html>");
    expect(await remounted).toEqual({ status: "ready", html: "<html>retry</html>" });
  });

  it("can dispose a subscriber before delivery of already cached HTML", async () => {
    const load = createMermaidRuntimeWebLoader(() => Promise.resolve("<html>runtime</html>"));
    await new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));
    const disposedResults: MermaidRuntimeHtmlResult[] = [];
    const dispose = load((result) => disposedResults.push(result));
    dispose();

    await new Promise<MermaidRuntimeHtmlResult>((resolve) => load(resolve));
    expect(disposedResults).toEqual([]);
  });
});
