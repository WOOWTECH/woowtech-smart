export type MermaidRuntimeHtmlResult = { status: "ready"; html: string } | { status: "failed" };

export function createMermaidRuntimeWebLoader(importHtml: () => Promise<string>) {
  let pending: Promise<string> | null = null;

  return function load(onResult: (result: MermaidRuntimeHtmlResult) => void): () => void {
    let active = true;
    // Preview and fullscreen share the download. A failed download must not poison later mounts.
    pending ??= importHtml().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    void pending.then(
      (html) => {
        if (active) onResult({ status: "ready", html });
        return undefined;
      },
      () => {
        if (active) onResult({ status: "failed" });
        return undefined;
      },
    );
    return () => {
      active = false;
    };
  };
}
