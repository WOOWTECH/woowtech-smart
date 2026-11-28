import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptiveTextInput } from "./adaptive-text-input";
import { SettingsTextArea } from "./settings-textarea";

interface MountedInput {
  root: Root;
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
}

const mountedInputs: MountedInput[] = [];

function SchedulePromptHarness({ changes }: { changes: string[] }) {
  const [prompt, setPrompt] = useState("");
  const handleChangeText = useCallback(
    (text: string) => {
      changes.push(text);
      setPrompt(text);
    },
    [changes],
  );
  return (
    <AdaptiveTextInput
      initialValue={prompt}
      multiline
      onChangeText={handleChangeText}
      testID="schedule-prompt-input"
    />
  );
}

function mountSchedulePrompt(changes: string[]): MountedInput {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<SchedulePromptHarness changes={changes} />));

  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Schedule prompt did not render a textarea");
  }

  const mounted = { root, container, textarea };
  mountedInputs.push(mounted);
  return mounted;
}

function typeFromIme(textarea: HTMLTextAreaElement, text: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!valueSetter) {
    throw new Error("HTML textarea value setter is unavailable");
  }
  valueSetter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

afterEach(() => {
  for (const mounted of mountedInputs.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("AdaptiveTextInput web IME composition", () => {
  it("keeps the candidate editing-surface owned until composition commits", () => {
    const changes: string[] = [];
    const { textarea } = mountSchedulePrompt(changes);

    act(() => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      typeFromIme(textarea, "n");
    });

    expect(textarea.value).toBe("n");
    expect(changes).toEqual([]);

    act(() => {
      textarea.value = "你";
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });

    expect(textarea.value).toBe("你");
    expect(changes).toEqual(["你"]);
  });
});

function SettingsPromptHarness({ value, changes }: { value: string; changes: string[] }) {
  const handleChangeText = useCallback(
    (text: string) => {
      changes.push(text);
    },
    [changes],
  );
  return (
    <SettingsTextArea
      accessibilityLabel="System prompt"
      value={value}
      onChangeText={handleChangeText}
    />
  );
}

describe("SettingsTextArea programmatic values", () => {
  function mountSettings(value: string, changes: string[]) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (next: string) =>
      act(() => root.render(<SettingsPromptHarness value={next} changes={changes} />));
    render(value);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Settings field did not render a textarea");
    mountedInputs.push({ root, container, textarea });
    return { textarea, render, container };
  }

  it("shows the saved value after Reset without replacing the editing surface", () => {
    const changes: string[] = [];
    const { textarea, render, container } = mountSettings("saved prompt", changes);
    act(() => typeFromIme(textarea, "unsaved prompt"));
    render("unsaved prompt");
    render("saved prompt");
    expect(textarea.value).toBe("saved prompt");
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(changes).toEqual(["unsaved prompt"]);
    act(() => typeFromIme(textarea, "another edit"));
    expect(changes).toEqual(["unsaved prompt", "another edit"]);
  });

  it("loads a saved value after mount and leaves IME candidates unpublished", () => {
    const changes: string[] = [];
    const { textarea, render } = mountSettings("", changes);
    render("loaded prompt");
    expect(textarea.value).toBe("loaded prompt");
    expect(changes).toEqual([]);
    act(() => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      typeFromIme(textarea, "n");
    });
    expect(textarea.value).toBe("n");
    expect(changes).toEqual([]);
    act(() => {
      textarea.value = "你";
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(changes).toEqual(["你"]);
  });
});
