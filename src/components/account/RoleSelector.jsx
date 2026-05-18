import { ROLES } from "@my-app/shared";

export function RoleSelector({ value, onChange, excludeOwner = true }) {
  const roles = excludeOwner ? ROLES.filter((r) => r.slug !== "owner") : ROLES;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
    >
      {roles.map((role) => (
        <option key={role.slug} value={role.slug}>
          {role.label}
        </option>
      ))}
    </select>
  );
}
