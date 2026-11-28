/** Finish helper cleanup without replacing a generation failure with a cleanup failure. */
export async function withHelperCleanup<Value>(
  run: () => Promise<Value>,
  cleanup: () => Promise<void>,
): Promise<Value> {
  const outcome = await Promise.resolve()
    .then(run)
    .then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    );
  try {
    await cleanup();
  } catch (error) {
    if (!outcome.ok) {
      throw new AggregateError(
        [outcome.error, error],
        `${String(outcome.error)}; ${String(error)}`,
        { cause: outcome.error },
      );
    }
    throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
