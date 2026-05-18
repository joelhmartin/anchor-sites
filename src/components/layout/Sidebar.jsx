import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { brand } from "../../config/brand.js";
import { ROUTES } from "../../config/routes.js";
import { usePermission } from "../../hooks/usePermission.js";

const navItems = [
  { label: "Dashboard", to: ROUTES.DASHBOARD, permission: null },
  { label: "Events", to: "/app/events", permission: null },
  { label: "Blog Posts", to: "/app/posts", permission: null },
  { label: "Members", to: ROUTES.MEMBERS, permission: "users:read" },
  { label: "Settings", to: ROUTES.SETTINGS, permission: "settings:read" },
];

export function Sidebar() {
  const { can } = usePermission();

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center px-6">
        <span className="text-lg font-bold text-gray-900">{brand.name}</span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          if (item.permission && !can(item.permission)) return null;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                )
              }
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
