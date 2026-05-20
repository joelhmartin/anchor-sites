import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

/**
 * Phase-5 placeholder (P4-T4.9 / D-017). The visual editor (Puck) lands
 * in Phase 5; this stands in so the "Edit" affordance has a destination.
 */
export function EditorPlaceholder() {
  const { slug, pageId } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <Link to={`/sites/${slug}`} className="text-sm text-indigo-600 hover:underline">
        ← Back to {slug}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Visual editor — coming in Phase 5</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-zinc-600">
          The drag-and-drop page editor (Puck) lands in Phase 5. This page
          (<code className="rounded bg-zinc-100 px-1">{pageId}</code>) will open in the
          editor then. For now, page content is edited via the admin API.
        </CardContent>
      </Card>
    </div>
  );
}
