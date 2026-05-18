import { useAccount } from "../hooks/useAccount.js";

export function RequireRole({ roles, children, fallback = null }) {
  const { activeAccount } = useAccount();

  if (!activeAccount || !roles.includes(activeAccount.role)) {
    return fallback;
  }

  return children;
}
