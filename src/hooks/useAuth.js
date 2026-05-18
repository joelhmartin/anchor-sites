import { useAuthStore } from "../stores/auth.store.js";

export function useAuth() {
  const { user, isAuthenticated, isLoading, login, register, logout, refresh, verifyMfa } =
    useAuthStore();

  return { user, isAuthenticated, isLoading, login, register, logout, refresh, verifyMfa };
}
