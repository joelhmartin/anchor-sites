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
  agentBusy = false,
}: {
  siteId: string;
  slug: string;
  change: AgentChangeEvent;
  onSiteChanged: () => void;
  /** D328 (W2-CONC): every mutation on a shared surface obeys the same busy
   * gate. Publish and Edit are disabled while the agent runs — Revert was
   * not, so a mid-build revert POSTed a restore that raced the running
   * agent's writes on the same page. Same title copy as Publish. */
  agentBusy?: boolean;
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
    <Card className="border-zinc-200 bg-zinc-50/60">
      <CardContent className="flex flex-col gap-2 p-3 pt-3 text-sm">
        <p className="text-zinc-700">{change.summary}</p>
        <div className="flex items-center gap-3">
          {change.page_id && (
            <Link
              to={`/sites/${slug}/pages/${change.page_id}`}
              className="text-xs font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600"
            >
              Open page
            </Link>
          )}
          {change.revision_id && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={revert}
              disabled={reverting || agentBusy}
              title={agentBusy ? "Agent is running" : undefined}
            >
              {reverting ? "Reverting…" : "Revert"}
            </Button>
          )}
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </CardContent>
    </Card>
  );
}
