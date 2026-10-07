"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Slim top-of-page progress bar that fires on every client-side navigation.
 * Matches the --color-primary (#c4c0ff) lavender from globals.css.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const prevPathname = useRef(pathname);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Only fire when the pathname actually changes
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;

    // Clear any in-flight animation
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    // Start: jump to 15% immediately, then ease toward 85%
    setProgress(15);
    setVisible(true);

    let current = 15;
    const tick = () => {
      // Logarithmic slow-down: advances quickly at first, crawls near 85%
      const remaining = 85 - current;
      current += remaining * 0.08;
      setProgress(current);
      if (current < 84.5) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    // Complete: slam to 100%, then fade out
    timerRef.current = setTimeout(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(100);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 300);
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [pathname]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="nav-progress"
          className="fixed top-0 left-0 right-0 z-[9999] h-[2px] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Bar */}
          <div
            className="h-full transition-all ease-out"
            style={{
              width: `${progress}%`,
              transitionDuration: progress === 100 ? "200ms" : "80ms",
              background:
                "linear-gradient(90deg, #c4c0ff 0%, #a89fff 60%, #c4c0ff 100%)",
              boxShadow: "0 0 8px 1px rgba(196, 192, 255, 0.5)",
            }}
          />
          {/* Glow tip */}
          <div
            className="absolute top-[-2px] h-[6px] w-[60px] rounded-full blur-sm"
            style={{
              right: `${100 - progress}%`,
              background: "rgba(196, 192, 255, 0.6)",
              transform: "translateX(50%)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
