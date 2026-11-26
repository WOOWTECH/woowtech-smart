import { expect, test, vi } from "vitest";
import { withHelperCleanup } from "./helper-cleanup";

test("successful generation finishes cleanup before returning the result", async () => {
  const events: string[] = [];
  const result = await withHelperCleanup(
    async () => {
      events.push("generated");
      return "title";
    },
    async () => {
      events.push("archived");
    },
  );
  expect(result).toBe("title");
  expect(events).toEqual(["generated", "archived"]);
});

test.each([new Error("provider failed"), null])(
  "generation failure is preserved after cleanup: %s",
  async (failure) => {
    const cleanup = vi.fn(async () => {});
    await expect(
      withHelperCleanup(async () => {
        throw failure;
      }, cleanup),
    ).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledTimes(1);
  },
);

test("cleanup failure prevents reporting a successful generation", async () => {
  const failure = new Error("archive failed");
  await expect(
    withHelperCleanup(
      async () => "title",
      async () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
});

test("simultaneous generation and cleanup failures retain both errors and the original cause", async () => {
  const generation = new Error("provider failed");
  const cleanup = new Error("archive failed");
  await expect(
    withHelperCleanup(
      async () => {
        throw generation;
      },
      async () => {
        throw cleanup;
      },
    ),
  ).rejects.toMatchObject({
    name: "AggregateError",
    cause: generation,
    errors: [generation, cleanup],
    message: "Error: provider failed; Error: archive failed",
  });
});
