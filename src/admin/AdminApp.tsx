import { Route, Routes } from "react-router-dom";
import { RequireAdmin } from "./auth/RequireAdmin.js";
import { LoginPage } from "./auth/LoginPage.js";
import { AdminLayout } from "./AdminLayout.js";
import { SitesListPage } from "./pages/SitesListPage.js";
import { NewSiteWizard } from "./pages/NewSiteWizard.js";
import { SiteDetailPage } from "./pages/SiteDetailPage.js";
import { EditorPlaceholder } from "./pages/EditorPlaceholder.js";
import { NotFound } from "./pages/NotFound.js";

/**
 * Admin SPA route tree (P4-T4.9). Mounted by `src/App.jsx` when running
 * on the admin host. Public `/login`; everything else behind
 * `<RequireAdmin>` + `<AdminLayout>`.
 */
export function AdminApp() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAdmin />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<SitesListPage />} />
          <Route path="/sites/new" element={<NewSiteWizard />} />
          <Route path="/sites/:slug" element={<SiteDetailPage />} />
          <Route path="/sites/:slug/pages/:pageId" element={<EditorPlaceholder />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
