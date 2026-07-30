import { Route, Routes } from "react-router-dom";
import { RequireAdmin } from "./auth/RequireAdmin.js";
import { LoginPage } from "./auth/LoginPage.js";
import { AdminLayout } from "./AdminLayout.js";
import { SitesListPage } from "./pages/SitesListPage.js";
import { NewSiteWizard } from "./pages/NewSiteWizard.js";
import { SiteDetailPage } from "./pages/SiteDetailPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";
import { EditorPage } from "./pages/EditorPage.js";
import { PostEditorPage } from "./pages/PostEditorPage.js";
import { EventEditorPage } from "./pages/EventEditorPage.js";
import { NotFound } from "./pages/NotFound.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

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
        <Route element={<AdminLayout />}>
          <Route path="/" element={<SitesListPage />} />
          <Route path="/sites/new" element={<NewSiteWizard />} />
          {/* Task B2 (2026-07-30 lovable-workspace SDD): `/sites/:slug` is
              now the Lovable-style workspace (chat + live preview) — the
              tab-based management shell moved to `/manage`. AdminLayout
              detects this route by URL shape (`isWorkspacePath`) to render
              its fullbleed chrome variant. */}
          <Route path="/sites/:slug" element={<WorkspacePage />} />
          <Route path="/sites/:slug/manage" element={<SiteDetailPage />} />
          <Route path="/sites/:slug/pages/:pageId" element={<EditorPage />} />
          <Route path="/sites/:slug/posts/:postId" element={<PostEditorPage />} />
          <Route path="/sites/:slug/events/:eventId" element={<EventEditorPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
