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
  media_count: number;
};
