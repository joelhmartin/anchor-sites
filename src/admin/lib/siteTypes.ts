export type SiteStatus = "active" | "archived" | "suspended";

export type SiteListRow = {
  id: string;
  slug: string;
  display_name: string;
  status: SiteStatus;
  created_at: string;
  pages_count: number;
};

export type SiteDetail = SiteListRow & {
  default_brand_tokens: Record<string, string>;
  /** P9-T9.3 — site-level SEO defaults (`sites.seo_defaults`). */
  seo_defaults?: Record<string, unknown> | null;
  /** P11-T11.1 (D-052) — CTM account ID; null = CTM not installed. */
  ctm_account_id?: string | null;
  /** P11-T11.1 (D-053) — CRM site ID; null = not yet provisioned. */
  crm_site_id?: string | null;
  media_count: number;
};
