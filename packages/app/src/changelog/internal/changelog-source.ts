import { useCallback, useEffect, useState } from "react";
import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { parseChangelog, type ChangelogRelease } from "./parse-changelog";

const CHANGELOG_URL = BRAND_LINKS.changelogSource;

export type ChangelogState =
  | { status: "loading" }
  | { status: "ready"; releases: ChangelogRelease[] }
  | { status: "empty" }
  | { status: "error" };

// The releases repository has no CHANGELOG.md, or one without a release, until the
// first release ships. That is not a connection problem.
class NoReleaseNotesYet extends Error {}

// Survives close/reopen so the second look paints without a spinner. The raw
// text is kept alongside the releases so an unchanged revalidation can be
// dropped: handing back an equal-but-new array would re-render every release.
let cached: { markdown: string; releases: ChangelogRelease[] } | null = null;

export interface Changelog {
  state: ChangelogState;
  reload: () => void;
}

/**
 * Reads the changelog from the repository the app was built from.
 *
 * The daemon is not involved: the changelog describes the app, a phone reaching
 * a relay already has internet, and going through a host would make the notes
 * depend on which host happens to be connected.
 *
 * Every open refetches, because the whole point of opening it is a release that
 * shipped after this app started. A previous result stays on screen while that
 * happens, and survives a failed revalidation.
 */
export function useChangelog(enabled: boolean): Changelog {
  const [state, setState] = useState<ChangelogState>(readCache);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    setState(readCache());

    void (async () => {
      try {
        const response = await fetch(CHANGELOG_URL, { signal: controller.signal });
        if (response.status === 404) throw new NoReleaseNotesYet();
        if (!response.ok) throw new Error(`Changelog request failed: ${response.status}`);
        const markdown = await response.text();
        if (cached?.markdown === markdown) return;
        const releases = parseChangelog(markdown);
        if (releases.length === 0) throw new NoReleaseNotesYet();
        cached = { markdown, releases };
        setState({ status: "ready", releases });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (cached) return;
        setState({ status: error instanceof NoReleaseNotesYet ? "empty" : "error" });
      }
    })();

    return () => controller.abort();
  }, [enabled, attempt]);

  const reload = useCallback(() => {
    cached = null;
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload };
}

function readCache(): ChangelogState {
  return cached ? { status: "ready", releases: cached.releases } : { status: "loading" };
}
