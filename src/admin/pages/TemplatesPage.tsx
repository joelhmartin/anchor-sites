import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../ui/table.js";

type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  kind: "site" | "page";
  description: string | null;
  pages_count: number;
};

/**
 * Templates management surface (D429 — the forward path the save-as-template
 * dialog now links to; coordinates with W3 D721). Minimal by design: lists the
 * active templates and lets an operator archive one (`DELETE /api/templates/:id`
 * is a soft archive). Rename isn't offered — the API has no PATCH for
 * templates yet; that lands with D721.
 */
export function TemplatesPage() {
  const { data, loading, error, reload } = useApi<{ templates: TemplateRow[] }>("/api/templates");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const templates = data?.templates ?? [];

  async function archive(t: TemplateRow) {
    if (!window.confirm(`Archive the template “${t.name}”? It stops appearing in the gallery.`)) return;
    setBusyId(t.id);
    setActionError(null);
    try {
      await apiFetch(`/api/templates/${t.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn’t archive the template.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Sites
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        Reusable site and page templates. Save a site as a template from its manage header.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading templates…
        </div>
      )}
      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load templates: {error}</CardContent>
        </Card>
      )}
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {!loading && !error && templates.length === 0 && (
        <Card>
          <CardContent className="pt-5 text-sm text-zinc-600">
            No templates yet. Save a site as a template to reuse it.
          </CardContent>
        </Card>
      )}

      {!loading && !error && templates.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Kind</TH>
                  <TH>Pages</TH>
                  <TH>{""}</TH>
                </TR>
              </THead>
              <TBody>
                {templates.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium text-zinc-900">
                      {t.name}
                      {t.description && (
                        <span className="block text-xs font-normal text-zinc-400">{t.description}</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={t.kind === "site" ? "success" : "neutral"}>{t.kind}</Badge>
                    </TD>
                    <TD>{t.pages_count}</TD>
                    <TD>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === t.id}
                        onClick={() => archive(t)}
                      >
                        {busyId === t.id ? <Spinner /> : "Archive"}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
