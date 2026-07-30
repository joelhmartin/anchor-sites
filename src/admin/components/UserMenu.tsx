import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User as UserIcon } from "lucide-react";
import { signOut } from "../lib/session.js";

/**
 * Top-bar avatar/menu button (Task B6, 2026-07-30 lovable-workspace SDD,
 * screenshot-driven follow-up): the workspace route now renders full-bleed,
 * outside `AdminLayout`'s sidebar — which was this screen's only sign-out
 * affordance. This menu is the replacement: a link back to the sites list,
 * and "Sign out" — the EXACT handler `AdminLayout`'s sidebar button used
 * (`signOut()` then a hard navigate to `/login`; see `AdminLayout.tsx`).
 *
 * No "Profile" entry: there's no profile route anywhere in this app to link
 * to (checked — `AdminApp.tsx`'s route tree has none).
 *
 * Hand-rolled rather than a Radix dropdown-menu primitive: `package.json`
 * only carries `@radix-ui/react-dialog`, not `@radix-ui/react-dropdown-menu`,
 * and this task may not add a new runtime dependency for one menu. Mirrors
 * the outside-click + Escape-to-close + anchored-popover pattern
 * `WorkspacePage`'s own Publish confirmation already uses — same rationale:
 * this hangs off its trigger button, it doesn't take over the screen the way
 * `ui/dialog.tsx`'s full Radix dialog does.
 */
export function UserMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700"
      >
        <UserIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
        >
          <Link
            to="/"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Sites
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
