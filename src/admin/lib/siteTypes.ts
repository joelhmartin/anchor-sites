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
  media_count: number;
};
