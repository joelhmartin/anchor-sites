import { useApi } from "../lib/useApi.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";

/**
 * Studio jobs-health surface (D606/D1009 — "failures visible from the
 * product, not just Cloud Logging"). Consumes GET /api/jobs/health, which
 * had ZERO consumers before this: queue depth and dead jobs were invisible
 * without gcloud/psql.
 *
 * Shows the jobs-runner liveness, the last pg-boss supervisor-loop error,
 * and a per-queue table of active/queued/retry/failed counts + the oldest
 * pending job's age — so a down worker, a dying maintenance loop, or a pile
 * of failed jobs is legible at a glance.
 */
type QueueHealth = {
  name: string;
  active: number;
  queued: number;
  retry: number;
  failed: number;
  completed: number;
  oldestPendingAgeSeconds: number | null;
};

type RunnerState = { status: "up" | "down" | "disabled"; error: string | null; since: string };
type BossError = { message: string; at: string } | null;

type JobsHealth = {
  enabled: boolean;
  runner: RunnerState;
  lastBossError: BossError;
  queues: QueueHealth[];
};

function humanizeAge(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

function runnerTone(status: RunnerState["status"]): "success" | "danger" | "neutral" {
  if (status === "up") return "success";
  if (status === "down") return "danger";
  return "neutral";
}

export function JobsHealthPage() {
  const { data, loading, error, reload } = useApi<JobsHealth>("/api/jobs/health");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Job queues</h1>
          <p className="text-sm text-zinc-500">
            Background work: site provisioning, template materialization, builds, GitHub sync,
            media, CRM.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </Button>
      </header>

      {loading && !data && (
        <Card>
          <CardContent className="flex items-center gap-2 pt-5 text-sm text-zinc-500">
            <Spinner /> Loading job health…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">
            Couldn't load job health: {error}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Worker
                <Badge tone={runnerTone(data.runner.status)}>{data.runner.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 pt-0 text-sm text-zinc-600">
              {data.runner.status === "down" && (
                <p className="text-red-600">
                  The job runner is down — queued work (provisioning, builds, media, sync) is not
                  being processed.
                  {data.runner.error ? ` (${data.runner.error})` : ""}
                </p>
              )}
              {data.runner.status === "disabled" && (
                <p>The job runner is disabled in this environment.</p>
              )}
              {data.lastBossError && (
                <p className="text-amber-700">
                  Last queue error: {data.lastBossError.message} ({data.lastBossError.at})
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Queues</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-zinc-500">
                      <th className="py-2 pr-4 font-medium">Queue</th>
                      <th className="py-2 pr-4 font-medium">Active</th>
                      <th className="py-2 pr-4 font-medium">Queued</th>
                      <th className="py-2 pr-4 font-medium">Retry</th>
                      <th className="py-2 pr-4 font-medium">Failed</th>
                      <th className="py-2 pr-4 font-medium">Oldest pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queues.map((q) => (
                      <tr key={q.name} className="border-b border-zinc-100">
                        <td className="py-2 pr-4 font-mono text-xs text-zinc-800">{q.name}</td>
                        <td className="py-2 pr-4">{q.active}</td>
                        <td className="py-2 pr-4">{q.queued}</td>
                        <td className="py-2 pr-4">{q.retry}</td>
                        <td className="py-2 pr-4">
                          {q.failed > 0 ? (
                            <span className="font-semibold text-red-600">{q.failed}</span>
                          ) : (
                            0
                          )}
                        </td>
                        <td className="py-2 pr-4 text-zinc-500">
                          {humanizeAge(q.oldestPendingAgeSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
