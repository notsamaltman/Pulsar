"use client";

import { motion } from "framer-motion";

export function AuthLoading() {
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-[#000000]">
      <div className="relative flex items-center justify-center scale-150">
        <motion.div
           animate={{ rotate: 360 }}
           transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
           className="w-24 h-24 border-t-2 border-primary/20 rounded-full"
        />
        <motion.div
           animate={{ rotate: -360 }}
           transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
           className="absolute w-16 h-16 border-b-2 border-primary/40 rounded-full"
        />
        <motion.div
           animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
           transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
           className="absolute w-8 h-8 bg-primary/20 rounded-full blur-sm"
        />
        <div className="absolute w-4 h-4 bg-primary rounded-full shadow-[0_0_15px_rgba(196,192,255,0.8)]" />
      </div>
    </div>
  );
}
