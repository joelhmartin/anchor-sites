import { useAccountStore } from "../stores/account.store.js";
import { hasPermission, getPermissionsForRole } from "@my-app/shared";

export function usePermission() {
  const activeAccount = useAccountStore((s) => s.activeAccount);

  const permissions = activeAccount
    ? getPermissionsForRole(activeAccount.role)
    : [];

  const can = (required) => hasPermission(permissions, required);

  return { can, permissions };
}
