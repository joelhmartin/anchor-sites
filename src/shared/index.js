// Stub for @my-app/shared — replaces monorepo package dependency.
// Zod schemas and permission helpers used by auth/account components.
import { z } from "zod";

// ── Auth schemas ─────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name:     z.string().min(2, "Name must be at least 2 characters"),
  email:    z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  password:        z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path:    ["confirmPassword"],
});

export const magicLinkSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const mfaVerifySchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
});

export const mfaEnableSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
});

// ── Account schemas ──────────────────────────────────────────────────────────

export const updateAccountSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

export const createInviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role:  z.string().min(1, "Role is required"),
});

// ── Roles & permissions ──────────────────────────────────────────────────────

export const ROLES = {
  OWNER:  "owner",
  ADMIN:  "admin",
  MEMBER: "member",
};

const PERMISSIONS = {
  [ROLES.OWNER]:  ["manage_members", "manage_account", "view_dashboard"],
  [ROLES.ADMIN]:  ["manage_members", "view_dashboard"],
  [ROLES.MEMBER]: ["view_dashboard"],
};

export function getPermissionsForRole(role) {
  return PERMISSIONS[role] ?? [];
}

export function hasPermission(role, permission) {
  return getPermissionsForRole(role).includes(permission);
}
