import { useScrollReveal } from "../hooks/useScrollReveal.js";

export function AnimateOnView({ children, className, ...options }) {
  const ref = useScrollReveal(options);
  return (
    <div ref={ref} className={className} style={{ opacity: 0 }}>
      {children}
    </div>
  );
}
