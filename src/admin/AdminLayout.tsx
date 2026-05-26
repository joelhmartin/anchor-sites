import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "./lib/session.js";
import { cn } from "./ui/cn.js";

/**
 * Admin shell chrome (P4-T4.9): left sidebar + content outlet. Rendered
 * inside `<RequireAdmin>` so it only shows for authenticated sessions.
 */
export function AdminLayout() {
  const navigate = useNavigate();
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
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
