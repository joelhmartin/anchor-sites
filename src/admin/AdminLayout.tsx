import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { signOut } from "./lib/session.js";
import { cn } from "./ui/cn.js";

/**
 * Task B2 (2026-07-30 lovable-workspace SDD): matches the Lovable-style
 * workspace route (`/sites/:slug`) and nothing else — specifically NOT
 * `/sites/new` (the wizard, a static sibling route) and NOT any route with
 * a further path segment (`/manage`, `/pages/:id`, …), which all keep the
 * padded, width-capped article chrome every other admin page uses.
 *
 * `<Route handle>` + `useMatches` would be the idiomatic way to let a route
 * declare its own layout needs, but `useMatches` only works with a data
 * router (`createBrowserRouter`/`createMemoryRouter`) — this app uses plain
 * `<Routes>`, so `AdminLayout` has no route-tree context to read `handle`
 * from. Matching the URL shape directly is the pragmatic alternative.
 */
function isWorkspacePath(pathname: string): boolean {
  return /^\/sites\/(?!new$)[^/]+$/.test(pathname);
}

/**
 * Admin shell chrome (P4-T4.9): left sidebar + content outlet. Rendered
 * inside `<RequireAdmin>` so it only shows for authenticated sessions.
 *
 * Task B2: the workspace page needs the full viewport height for its
 * chat/preview grid, not the padded, width-capped article column every
 * other admin page uses — `isWorkspacePath` swaps just the `<main>`
 * wrapper for it; sidebar/chrome are unchanged either way.
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const fullBleed = isWorkspacePath(location.pathname);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="px-5 py-4">
          <Link to="/" className="text-base font-semibold tracking-tight">
            AnchorCorps <span className="text-indigo-600">Studio</span>
          </Link>
        </div>
        <nav className="flex-1 px-2">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "block rounded-md px-3 py-2 text-sm font-medium",
                isActive ? "bg-indigo-50 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100",
              )
            }
          >
            Sites
          </NavLink>
        </nav>
        <div className="border-t border-zinc-200 p-2">
          <button
            type="button"
            onClick={handleSignOut}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100"
          >
            Sign out
          </button>
        </div>
      </aside>
      {fullBleed ? (
        <main className="h-screen flex-1 overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-5xl px-6 py-8">
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}
