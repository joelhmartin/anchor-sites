import { clsx } from "clsx";

export function H1({ children, className, ...props }) {
  return (
    <h1 className={clsx("text-3xl font-bold tracking-tight text-gray-900", className)} {...props}>
      {children}
    </h1>
  );
}

export function H2({ children, className, ...props }) {
  return (
    <h2 className={clsx("text-2xl font-semibold text-gray-900", className)} {...props}>
      {children}
    </h2>
  );
}

export function H3({ children, className, ...props }) {
  return (
    <h3 className={clsx("text-lg font-semibold text-gray-900", className)} {...props}>
      {children}
    </h3>
  );
}

export function Text({ children, className, muted = false, ...props }) {
  return (
    <p className={clsx("text-sm", muted ? "text-gray-500" : "text-gray-700", className)} {...props}>
      {children}
    </p>
  );
}
