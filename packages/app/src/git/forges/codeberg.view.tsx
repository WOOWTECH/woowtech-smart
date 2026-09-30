import { CodebergIcon } from "@/components/icons/codeberg-icon";
import type { ClientForgeViewModule } from "@/git/client-forge-module";

export const codebergForgeView = {
  id: "codeberg",
  icon: CodebergIcon,
  // woowtech smart: Codeberg's guidelines forbid tinting its logo, so the mark draws in pure black
  // or white by the theme (woowtech/README.md §24).
  brandColor: null,
} satisfies ClientForgeViewModule;
