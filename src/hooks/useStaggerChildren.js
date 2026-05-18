import { useEffect, useRef } from "react";
import gsap from "gsap";

export function useStaggerChildren(options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { stagger = 0.1, y = 20, opacity = 0, duration = 0.5 } = options;

    gsap.fromTo(
      el.children,
      { y, opacity },
      { y: 0, opacity: 1, duration, stagger, ease: "power2.out" },
    );
  }, []);

  return ref;
}
