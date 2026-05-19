import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn `cn` utility — `clsx` for conditional composition plus
 * `tailwind-merge` to resolve conflicting Tailwind classes. Used by every
 * primitive and opinionated block in this package.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
