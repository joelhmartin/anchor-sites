import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { RequireAdmin } from "./auth/RequireAdmin.js";
import { LoginPage } from "./auth/LoginPage.js";
import { AdminLayout } from "./AdminLayout.js";
import { SitesListPage } from "./pages/SitesListPage.js";
import { NewSitePage } from "./pages/NewSitePage.js";
import { SiteDetailPage } from "./pages/SiteDetailPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";
import { PostEditorPage } from "./pages/PostEditorPage.js";
import { EventEditorPage } from "./pages/EventEditorPage.js";
import { JobsHealthPage } from "./pages/JobsHealthPage.js";
import { TemplatesPage } from "./pages/TemplatesPage.js";
import { NotFound } from "./pages/NotFound.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

/**
 * Task B5 (2026-07-30 lovable-workspace SDD): the Puck page editor route
 * (`/sites/:slug/pages/:pageId`) is gone — page editing is chat + inline
 * editing in the workspace. Redirect any old bookmarked/shared link straight
 * into the workspace with the same page preselected via `?page=` (already
 * supported by `WorkspacePage` for the PagesTab "preview" deep link).
 */
function PageEditRedirect() {
  const { slug, pageId } = useParams();
  return <Navigate to={`/sites/${slug}?page=${pageId}`} replace />;
}

/**
 * Admin SPA route tree (P4-T4.9). Mounted by `src/App.jsx` when running
 * on the admin host. Public `/login`; everything else behind
 * `<RequireAdmin>` + `<AdminLayout>`.
 */
export function AdminApp() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAdmin />}>
        {/* Task B2 (2026-07-30 lovable-workspace SDD): `/sites/:slug` is the
            Lovable-style workspace (chat + live preview) — the tab-based
            management shell moved to `/manage`. Task B6's screenshot-driven
            follow-up: this route is now a SIBLING of `<AdminLayout>`, not a
            child of it — the workspace renders full-bleed, with none of the
            sidebar's ~220px chrome (its own top bar/chat rail carry the
            wordmark, nav, and sign-out that the sidebar used to). Every
            other authenticated route still gets the padded, width-capped
            shell below. */}
        <Route path="/sites/:slug" element={<WorkspacePage />} />
        <Route element={<AdminLayout />}>
          <Route path="/" element={<SitesListPage />} />
          <Route path="/jobs" element={<JobsHealthPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/sites/new" element={<NewSitePage />} />
          <Route path="/sites/:slug/manage" element={<SiteDetailPage />} />
          <Route path="/sites/:slug/pages/:pageId" element={<PageEditRedirect />} />
          <Route path="/sites/:slug/posts/:postId" element={<PostEditorPage />} />
          <Route path="/sites/:slug/events/:eventId" element={<EventEditorPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
