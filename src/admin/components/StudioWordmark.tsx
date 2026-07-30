import { Link } from "react-router-dom";
import { cn } from "../ui/cn.js";

/**
 * The Studio's own brand mark — "AnchorCorps Studio" — factored out of
 * `AdminLayout`'s sidebar (Task B6, 2026-07-30 lovable-workspace SDD,
 * screenshot-driven follow-up) so the layout-free workspace route can render
 * the EXACT same wordmark at the top of its chat rail (operator: "reuse the
 * exact logo/wordmark ... the admin shell's sidebar uses") instead of a
 * second, driftable copy. There is no separate logo image asset for the
 * Studio admin — `src/images/logoFull.jsx`/`logoIcon.jsx` are the CLIENT
 * marketing-site brand mark (`src/components/marketing/Navbar.jsx`), a
 * different brand entirely. Always links back to the sites list.
 */
export function StudioWordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("text-base font-semibold tracking-tight text-zinc-900", className)}>
      AnchorCorps <span className="text-indigo-600">Studio</span>
    </Link>
  );
}
