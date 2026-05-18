import { create } from "zustand";
import { getPermissionsForRole } from "@my-app/shared";

/**
 * Account store — offline mode with a mock account for the admin.
 */

const MOCK_ACCOUNT = {
  accountId: "acct_1",
  accountName: "Default Account",
  role: "owner",
};

export const useAccountStore = create((set, get) => ({
  accounts: [],
  activeAccount: null,
  isLoading: false,

  fetchAccounts: async () => {
    set({ isLoading: true });
    // Mock: return one account for the logged-in admin
    const accounts = [MOCK_ACCOUNT];
    set({ accounts, activeAccount: MOCK_ACCOUNT, isLoading: false });
    sessionStorage.setItem("activeAccountId", MOCK_ACCOUNT.accountId);
  },

  switchAccount: (accountId) => {
    const account = get().accounts.find((a) => a.accountId === accountId);
    if (account) {
      set({ activeAccount: account });
      sessionStorage.setItem("activeAccountId", accountId);
    }
  },

  createAccount: async () => {
    throw new Error("Account creation disabled in offline mode");
  },

  getPermissions: () => {
    const { activeAccount } = get();
    if (!activeAccount) return [];
    return getPermissionsForRole(activeAccount.role);
  },
}));
