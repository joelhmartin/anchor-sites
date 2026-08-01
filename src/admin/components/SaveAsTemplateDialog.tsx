import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";

/**
 * Save-as-template dialog (P7-T7.8). Captures the current site (all pages, or a
 * selected subset) into a reusable `kind:'site'` template via
 * `POST /api/sites/:siteId/save-as-template`. Pages are fetched when the dialog
 * opens; all are selected by default.
 */

type PageRow = { id: string; slug: string; title: string };

export function SaveAsTemplateDialog({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pages, setPages] = useState<PageRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPages, setLoadingPages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Reset and load the site's pages each time it opens.
      setName("");
      setDescription("");
      setError(null);
      setSavedName(null);
      setLoadingPages(true);
      try {
        const res = await apiFetch<{ pages: PageRow[] }>(`/api/sites/${siteId}/pages`);
        setPages(res.pages);
        setSelected(new Set(res.pages.map((p) => p.id)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn’t load pages.");
      } finally {
        setLoadingPages(false);
      }
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit = name.trim().length > 0 && selected.size > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/save-as-template`, {
        method: "POST",
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          // Omit page_ids when every page is selected (capture all).
          page_ids: selected.size === pages.length ? undefined : [...selected],
        },
      });
      setSavedName(name.trim());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("A template with that name already exists. Try a different name.");
      } else if (err instanceof ApiError && err.status === 422) {
        setError("Some blocks on the selected pages didn’t validate; fix them and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn’t save the template.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => onOpenChange(true)}>
        Save as template
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title="Save as template">
          <DialogDescription>
            Capture {siteName}’s pages and brand colors as a reusable template.
          </DialogDescription>

          {savedName ? (
            <div className="mt-4 flex flex-col gap-4">
              <p className="text-sm text-green-700">Saved “{savedName}” as a template.</p>
              {/* D429 — a "where did it go" forward path: link to the templates
                  management surface to view/archive it. */}
              <Link
                to="/templates"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => setOpen(false)}
              >
                Manage templates →
              </Link>
              <div className="flex justify-end">
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl_name">Template name</Label>
                <Input
                  id="tpl_name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${siteName} template`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl_desc">Description (optional)</Label>
                <Input
                  id="tpl_desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this template for?"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-zinc-700">Pages to include</span>
                {loadingPages ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Spinner /> Loading pages…
                  </div>
                ) : pages.length === 0 ? (
                  <p className="text-sm text-zinc-500">This site has no pages yet.</p>
                ) : (
                  <ul className="flex max-h-48 flex-col gap-1 overflow-auto">
                    {pages.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                            aria-label={p.title}
                          />
                          <span>{p.title}</span>
                          <span className="text-xs text-zinc-400">/{p.slug}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={!canSubmit}>
                  {busy ? <Spinner /> : "Save template"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
