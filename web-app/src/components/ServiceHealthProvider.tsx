"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Zap } from "lucide-react";

export interface PlatformQuota {
  platform: string;
  status: "AVAILABLE" | "EXHAUSTED" | "RATE_LIMITED";
  resetAt: number | null;
  message?: string;
  available: boolean;
}

interface ServiceHealthContextType {
  isOffline: boolean;
  platformQuotas: Record<string, PlatformQuota>;
  checkHealth: () => Promise<void>;
}

const ServiceHealthContext = createContext<ServiceHealthContextType>({
  isOffline: false,
  platformQuotas: {},
  checkHealth: async () => {},
});

export const useServiceHealth = () => useContext(ServiceHealthContext);

export function ServiceHealthProvider({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState(false);
  const [platformQuotas, setPlatformQuotas] = useState<Record<string, PlatformQuota>>({});
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const lastToastKey = useRef<string | null>(null);

  const checkHealth = async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch("/api/service-health", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mlServiceActive) {
          setIsOffline(false);
        } else {
          setIsOffline(true);
        }

        if (data.platformQuotas) {
          setPlatformQuotas(data.platformQuotas);
        }

        const groq = data.groqStatus;
        if (groq?.isExhausted) {
          const key = String(groq.resetAt ?? groq.resetAtLabel ?? "exhausted");
          if (lastToastKey.current !== key) {
            lastToastKey.current = key;
            setToast({
              title: "API limit exhausted",
              body: "System on idle check — the running job was requeued at lower priority.",
            });
          }
        }
        return;
      }
      setIsOffline(true);
    } catch (error) {
      console.error("Health check error:", error);
      setIsOffline(true);
    } finally {
      clearTimeout(abortTimer);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 60000); // poll every 60s — 10s was hammering Workers CPU
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ServiceHealthContext.Provider value={{ isOffline, platformQuotas, checkHealth }}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed bottom-4 right-4 z-[80] w-[min(22rem,calc(100vw-1.5rem))] pointer-events-auto"
            role="status"
            aria-live="polite"
          >
            <div className="rounded-xl border border-amber-500/30 bg-[#171717] shadow-[0_12px_40px_rgba(0,0,0,0.55)] p-3.5 flex items-start gap-3">
              <div className="relative mt-0.5 shrink-0">
                <span className="absolute inset-0 rounded-full bg-amber-400/40 animate-ping" />
                <div className="relative w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black uppercase tracking-wider text-amber-200">
                  {toast.title}
                </p>
                <p className="text-[11px] leading-relaxed text-[#999] mt-0.5">
                  {toast.body}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#555] hover:text-white transition-colors px-1"
                aria-label="Dismiss"
              >
                Close
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ServiceHealthContext.Provider>
  );
}
