import { describe, expect, it } from "vitest";
import { HOST_SECTION_SLUGS, normalizeHostSectionSlug } from "@/utils/host-routes";
import {
  PROVIDER_USAGE_VISIBLE,
  visibleHostSection,
  visibleHostSections,
} from "./woowtech-usage-visibility";

// woowtech smart: account usage stays hidden (woowtech/README.md section 23). The host
// settings list has no "Usage" row, and a route to the usage section opens the default
// section instead of an empty usage page.

const SECTION_ITEMS = HOST_SECTION_SLUGS.map((id) => ({ id }));

describe("account usage visibility", () => {
  it("is hidden in woowtech smart", () => {
    expect(PROVIDER_USAGE_VISIBLE).toBe(false);
  });

  it("leaves the usage row out of the host settings list and keeps every other row in order", () => {
    expect(visibleHostSections(SECTION_ITEMS).map((item) => item.id)).toEqual([
      "projects",
      "connections",
      "pair-device",
      "agents",
      "metadata",
      "workspaces",
      "providers",
      "terminals",
      "plugins",
      "host",
    ]);
  });

  it("reads a route to the usage section as an unknown section", () => {
    expect(visibleHostSection(normalizeHostSectionSlug("usage"))).toBeNull();
    for (const section of HOST_SECTION_SLUGS.filter((slug) => slug !== "usage")) {
      expect(visibleHostSection(normalizeHostSectionSlug(section))).toBe(section);
    }
    expect(visibleHostSection(normalizeHostSectionSlug("daemon"))).toBe("host");
    expect(visibleHostSection(normalizeHostSectionSlug("unknown"))).toBeNull();
  });

  it("shows the usage row and route again when usage is turned back on", () => {
    expect(visibleHostSections(SECTION_ITEMS, true)).toEqual(SECTION_ITEMS);
    expect(visibleHostSection("usage", true)).toBe("usage");
  });
});
