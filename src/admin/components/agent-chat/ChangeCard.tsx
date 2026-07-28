// src/admin/components/agent-chat/ChangeCard.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "../../lib/apiFetch.js";
import type { AgentChangeEvent } from "../../lib/agent-api.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";

export function ChangeCard({
  siteId,
  slug,
  change,
  onSiteChanged,
}: {
  siteId: string;
  slug: string;
  change: AgentChangeEvent;
  onSiteChanged: () => void;
}) {
  const [reverting, setReverting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function revert() {
    if (!change.page_id || !change.revision_id) return;
    setReverting(true);
    setErr(null);
    try {
      await apiFetch(
        `/api/sites/${siteId}/pages/${change.page_id}/revisions/${change.revision_id}/restore`,
        { method: "POST" },
      );
      onSiteChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Revert failed.");
    } finally {
      setReverting(false);
    }
  }

  return (
    <Card className="border-indigo-200 bg-indigo-50/40">
      <CardContent className="flex flex-col gap-2 p-3 pt-3 text-sm">
        <p className="text-zinc-700">{change.summary}</p>
        <div className="flex items-center gap-3">
          {change.page_id && (
            <Link
              to={`/sites/${slug}/pages/${change.page_id}`}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Open page
            </Link>
          )}
          {change.revision_id && (
            <Button type="button" variant="outline" size="sm" onClick={revert} disabled={reverting}>
              {reverting ? "Reverting…" : "Revert"}
            </Button>
          )}
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </CardContent>
    </Card>
  );
}
