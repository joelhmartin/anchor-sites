import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Dialog, DialogContent, DialogDescription } from "../ui/dialog.js";
import { Spinner } from "../ui/spinner.js";
import { useApi } from "../lib/useApi.js";
import { TemplateCover } from "./TemplateCover.js";

/**
 * Template detail dialog (W1.1 / D205, D701): the review-before-choose step
 * the gallery never had. Card click opens this; it shows the cover, the
 * description, the category, and — first consumer of `GET /api/templates/:id`
 * — the template's actual page manifest, so choosing a template is no longer
 * blind. Primary CTA selects the template ("Use this template"); secondary
 * opens the full-screen rendered preview.
 */

export type TemplatePageRef = { slug: string; title: string };

export type TemplateSummary = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  cover_image_url?: string | null;
  pages_count?: number;
};

export type TemplateDetailDialogProps = {
  template: TemplateSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Use this template" — select + close (the page owns both). */
  onUse: () => void;
  /** "Preview" — open the full-screen preview with the fetched manifest. */
  onPreview: (pages: TemplatePageRef[]) => void;
};

type TemplateDetail = {
  template: TemplateSummary;
  pages: TemplatePageRef[];
};

export function TemplateDetailDialog({
  template,
  open,
  onOpenChange,
  onUse,
  onPreview,
}: TemplateDetailDialogProps) {
  const { data, loading, error, reload } = useApi<TemplateDetail>(`/api/templates/${template.id}`);
  const pages = data?.pages ?? null;
  const pagesCount = pages?.length ?? template.pages_count;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={template.name} className="max-w-xl p-0" titleClassName="px-6 pt-6">
        <div className="flex flex-col">
          <div className="px-6">
            {template.category && (
              <div className="mt-1">
                <Badge tone="neutral">{template.category}</Badge>
              </div>
            )}
            {template.description && (
              <DialogDescription className="mt-2">{template.description}</DialogDescription>
            )}
          </div>

          <div className="group mt-4 overflow-hidden border-y border-zinc-100">
            <TemplateCover name={template.name} coverImageUrl={template.cover_image_url} className="h-48" />
          </div>

          <div className="flex flex-col gap-2 px-6 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              {typeof pagesCount === "number"
                ? `${pagesCount} ${pagesCount === 1 ? "page" : "pages"}`
                : "Pages"}
            </p>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Spinner /> Loading pages…
              </div>
            ) : error ? (
              <p className="text-sm text-red-600">
                Couldn't load the page list.{" "}
                <button type="button" onClick={reload} className="font-medium underline underline-offset-2">
                  Retry
                </button>
              </p>
            ) : pages && pages.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {pages.map((p) => (
                  <li
                    key={p.slug}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs text-zinc-600"
                  >
                    {p.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">This template has no pages.</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4">
            <Button
              variant="outline"
              disabled={!pages || pages.length === 0}
              title={!pages || pages.length === 0 ? "Page list still loading" : undefined}
              onClick={() => pages && onPreview(pages)}
            >
              Preview
            </Button>
            <Button variant="dark" className="rounded-full px-5" onClick={onUse}>
              Use this template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
