import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** clsx + tailwind-merge — admin chrome's class composer (P4-T4.7). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
