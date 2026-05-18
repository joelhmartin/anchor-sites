import { usePermission } from "../hooks/usePermission.js";

export function RequirePermission({ perm, children, fallback = null }) {
  const { can } = usePermission();

  if (!can(perm)) {
    return fallback;
  }

  return children;
}
