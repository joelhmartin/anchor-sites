import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Spinner } from "../ui/spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../ui/table.js";

type SiteRow = {
  id: string;
  slug: string;
  display_name: string;
  status: "active" | "archived" | "suspended";
  created_at: string;
  pages_count: number;
};

const statusTone = {
  active: "success",
  archived: "neutral",
  suspended: "warning",
} as const;

export function SitesListPage() {
  const { data, loading, error } = useApi<{ sites: SiteRow[] }>("/api/sites");
  const navigate = useNavigate();
  const sites = data?.sites ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sites</h1>
        <Button onClick={() => navigate("/sites/new")}>+ New site</Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading sites…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load sites: {error}</CardContent>
        </Card>
      )}

      {!loading && !error && sites.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-5">
            <p className="text-sm text-zinc-600">No sites yet. Create your first one to get started.</p>
            <Button onClick={() => navigate("/sites/new")}>+ New site</Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && sites.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Slug</TH>
                  <TH>Status</TH>
                  <TH>Pages</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {sites.map((s) => (
                  <TR
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/sites/${s.slug}`)}
                  >
                    <TD className="font-medium text-zinc-900">
                      <Link to={`/sites/${s.slug}`} onClick={(e) => e.stopPropagation()}>
                        {s.display_name}
                      </Link>
                    </TD>
                    <TD>{s.slug}</TD>
                    <TD>
                      <Badge tone={statusTone[s.status]}>{s.status}</Badge>
                    </TD>
                    <TD>{s.pages_count}</TD>
                    <TD>{new Date(s.created_at).toLocaleDateString()}</TD>
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
