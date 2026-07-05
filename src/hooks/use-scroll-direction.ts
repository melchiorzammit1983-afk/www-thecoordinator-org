import { useEffect, useState } from "react";

/**
 * Returns "up" | "down" based on the most recent user scroll direction.
 * Throttled with requestAnimationFrame so header hide/show stays smooth.
 * Ignores tiny sub-threshold movements to prevent jitter.
 */
export function useScrollDirection(threshold = 6): "up" | "down" {
  const [dir, setDir] = useState<"up" | "down">("up");

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (Math.abs(delta) > threshold) {
          setDir(delta > 0 && y > 40 ? "down" : "up");
          lastY = y;
        }
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return dir;
}
