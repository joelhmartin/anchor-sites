import { useAccountStore } from "../stores/account.store.js";

export function useAccount() {
  const { accounts, activeAccount, isLoading, fetchAccounts, switchAccount, createAccount } =
    useAccountStore();

  return { accounts, activeAccount, isLoading, fetchAccounts, switchAccount, createAccount };
}
