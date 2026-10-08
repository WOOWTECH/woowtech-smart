/**
 * @vitest-environment jsdom
 */
// woowtech smart: tests for woowtech-file-explorer-reconnect.ts (woowtech/README.md section 14).
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRetryExplorerOnReconnect } from "./woowtech-file-explorer-reconnect";

interface Props {
  isConnected: boolean;
  hasError: boolean;
  retry: () => void;
}

function explorer(initial: Omit<Props, "retry">) {
  const retry = vi.fn();
  const view = renderHook((props: Props) => useRetryExplorerOnReconnect(props), {
    initialProps: { ...initial, retry },
  });
  return {
    retry,
    show: (next: Omit<Props, "retry">) => view.rerender({ ...next, retry }),
  };
}

describe("the file explorer after the host comes back", () => {
  it("retries once when it shows an error", () => {
    const { retry, show } = explorer({ isConnected: true, hasError: false });
    show({ isConnected: false, hasError: true });
    expect(retry).not.toHaveBeenCalled();

    show({ isConnected: true, hasError: true });
    expect(retry).toHaveBeenCalledTimes(1);

    show({ isConnected: true, hasError: true });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("retries when it opened while the host was offline", () => {
    const { retry, show } = explorer({ isConnected: false, hasError: true });
    show({ isConnected: true, hasError: true });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("leaves a listing without an error alone", () => {
    const { retry, show } = explorer({ isConnected: true, hasError: false });
    show({ isConnected: false, hasError: false });
    show({ isConnected: true, hasError: false });
    expect(retry).not.toHaveBeenCalled();
  });

  it("does nothing while the host stays offline or stays connected", () => {
    const { retry, show } = explorer({ isConnected: false, hasError: true });
    show({ isConnected: false, hasError: true });
    expect(retry).not.toHaveBeenCalled();

    const connected = explorer({ isConnected: true, hasError: true });
    connected.show({ isConnected: true, hasError: true });
    expect(connected.retry).not.toHaveBeenCalled();
  });
});
