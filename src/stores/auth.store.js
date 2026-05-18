import { create } from "zustand";

/**
 * Auth store — offline mode with hardcoded admin.
 * When a real backend is connected, replace the mock methods
 * with API calls (the original api.post/get pattern).
 */

const MOCK_ADMIN = {
  id: "1",
  email: "admin@example.com",
  name: "Site Admin",
  role: "owner",
};

const MOCK_PASSWORD = "123changeMe!";

export const useAuthStore = create((set, get) => ({
  user: JSON.parse(sessionStorage.getItem("bf_user") || "null"),
  accessToken: sessionStorage.getItem("bf_token") || null,
  isAuthenticated: !!sessionStorage.getItem("bf_token"),
  isLoading: false,

  setAccessToken: (token) => {
    sessionStorage.setItem("bf_token", token);
    set({ accessToken: token });
  },

  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),

  login: async ({ email, password }) => {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 400));

    if (email === MOCK_ADMIN.email && password === MOCK_PASSWORD) {
      const token = "mock-jwt-" + Date.now();
      sessionStorage.setItem("bf_token", token);
      sessionStorage.setItem("bf_user", JSON.stringify(MOCK_ADMIN));
      set({ user: MOCK_ADMIN, accessToken: token, isAuthenticated: true });
      return { user: MOCK_ADMIN, accessToken: token };
    }

    throw new Error("Invalid email or password");
  },

  register: async () => {
    throw new Error("Registration is disabled in offline mode");
  },

  logout: async () => {
    sessionStorage.removeItem("bf_token");
    sessionStorage.removeItem("bf_user");
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  refresh: async () => {
    // Restore from session if available
    const token = sessionStorage.getItem("bf_token");
    const user = JSON.parse(sessionStorage.getItem("bf_user") || "null");
    if (token && user) {
      set({ user, accessToken: token, isAuthenticated: true, isLoading: false });
    } else {
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  },

  verifyMfa: async () => {
    throw new Error("MFA not available in offline mode");
  },
}));
