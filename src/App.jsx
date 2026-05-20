import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { ToastProvider } from "./components/ui/Toast.jsx";
import { useAuthStore } from "./stores/auth.store.js";
import { useAccountStore } from "./stores/account.store.js";
import { RequireAuth } from "./guards/RequireAuth.jsx";
import { RequireAccount } from "./guards/RequireAccount.jsx";
import { AppShell } from "./components/layout/AppShell.jsx";
import { ROUTES } from "./config/routes.js";
import { SERVICES_NAV } from "./config/site.js";

// Auth pages
import { LoginPage } from "./pages/auth/LoginPage.jsx";
import { RegisterPage } from "./pages/auth/RegisterPage.jsx";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage.jsx";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage.jsx";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage.jsx";
import { MagicLinkPage } from "./pages/auth/MagicLinkPage.jsx";
import { AcceptInvitePage } from "./pages/auth/AcceptInvitePage.jsx";

// App pages
import { DashboardPage } from "./pages/app/DashboardPage.jsx";
import { SettingsPage } from "./pages/app/SettingsPage.jsx";
import { MembersPage } from "./pages/app/MembersPage.jsx";
import { EventsAdminPage } from "./pages/app/EventsAdminPage.jsx";
import { PostsAdminPage } from "./pages/app/PostsAdminPage.jsx";

// Marketing pages
import { HomePage } from "./pages/marketing/Home.jsx";
import { AboutPage } from "./pages/marketing/About.jsx";
import { ProductPage } from "./pages/marketing/Product.jsx";
import { ContactPage } from "./pages/marketing/Contact.jsx";
import { CaseSubmissionPage } from "./pages/marketing/CaseSubmission.jsx";
import { InstructionalVideosPage } from "./pages/marketing/InstructionalVideos.jsx";
import { ComingSoonPage } from "./pages/marketing/ComingSoon.jsx";
import { EventsPage } from "./pages/marketing/Events.jsx";
import { EventDetailPage } from "./pages/marketing/EventDetail.jsx";
import { BlogPage } from "./pages/marketing/Blog.jsx";
import { BlogPostPage } from "./pages/marketing/BlogPost.jsx";
import { Navbar } from "./components/marketing/Navbar.jsx";
import { Footer } from "./components/marketing/Footer.jsx";
import { CONTENT } from "./config/site.js";
import { BreakpointProvider } from "./hooks/useBreakpoint.jsx";
import { isAdminHost } from "./config/admin-host.ts";
import { AdminApp } from "./admin/AdminApp.tsx";

/* Marketing layout: Navbar + page + Footer */
function MarketingLayout() {
  return (
    <>
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

function AppRoutes() {
  const refresh = useAuthStore((s) => s.refresh);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);

  // Silent refresh on mount
  useEffect(() => {
    refresh();
  }, []);

  // Fetch accounts when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchAccounts();
    }
  }, [isAuthenticated]);

  return (
    <Routes>
      {/* Marketing routes */}
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/products" element={<ProductPage />} />
        <Route path="/contact" element={<ContactPage />} />
        {/* Events — paths driven by CONTENT config */}
        <Route path={CONTENT.events.listPath} element={<EventsPage />} />
        <Route path={`${CONTENT.events.listPath}${CONTENT.events.paginationSlug}/:page`} element={<EventsPage />} />
        <Route path={`${CONTENT.events.prefix}/:slug`} element={<EventDetailPage />} />
        {/* Blog — paths driven by CONTENT config */}
        <Route path={CONTENT.blog.listPath} element={<BlogPage />} />
        <Route path={`${CONTENT.blog.listPath}${CONTENT.blog.paginationSlug}/:page`} element={<BlogPage />} />
        <Route path={`${CONTENT.blog.prefix}/:slug`} element={<BlogPostPage />} />
        <Route path="/submit-case" element={<CaseSubmissionPage />} />
        {/* Services routes — driven by SERVICES_NAV config */}
        {SERVICES_NAV.map((svc) => (
          <Route key={svc.to} path={svc.to} element={<ComingSoonPage />} />
        ))}
        {/* Legacy / other coming soon routes */}
        <Route path="/about/team"                 element={<ComingSoonPage />} />
        <Route path="/resources/videos"           element={<ComingSoonPage />} />
      </Route>

      {/* Auth routes */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/magic-link" element={<MagicLinkPage />} />
      <Route path="/auth/accept-invite" element={<AcceptInvitePage />} />

      {/* OAuth callback */}
      <Route path="/auth/oauth-callback" element={<OAuthCallback />} />

      {/* Protected app routes */}
      <Route
        path="/app"
        element={
          <RequireAuth>
            <RequireAccount>
              <AppShell />
            </RequireAccount>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="events" element={<EventsAdminPage />} />
        <Route path="posts" element={<PostsAdminPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function OAuthCallback() {
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setAccessToken(token);
      refresh();
    }
    window.location.href = ROUTES.DASHBOARD;
  }, []);

  return null;
}

export default function App() {
  // Control hub (studio.anchorcorps.com / studio.localhost) gets the admin
  // SPA; every other host gets the marketing/app routes (P4-T4.9 / D-032).
  const onAdminHost =
    typeof window !== "undefined" && isAdminHost(window.location.host);

  if (onAdminHost) {
    return (
      <BrowserRouter>
        <AdminApp />
      </BrowserRouter>
    );
  }

  return (
    <BreakpointProvider>
      <BrowserRouter>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </BrowserRouter>
    </BreakpointProvider>
  );
}
