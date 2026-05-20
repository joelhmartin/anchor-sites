/** Pages list + new-page form land in P4-T4.13. Stubbed for the 4.12 tab shell. */
export function PagesTab({ siteId, slug }: { siteId: string; slug: string }) {
  return (
    <p className="text-sm text-zinc-500" data-site-id={siteId} data-slug={slug}>
      Pages list and the new-page form arrive in Task 4.13.
    </p>
  );
}
