import type { SiteDetail } from "../../lib/siteTypes.js";

/** Display-name + brand-token editing lands in P4-T4.15. Stubbed for the 4.12 tab shell. */
export function SettingsTab({ site }: { site: SiteDetail }) {
  return (
    <p className="text-sm text-zinc-500" data-site-id={site.id}>
      Display-name and brand-token editing arrive in Task 4.15.
    </p>
  );
}
