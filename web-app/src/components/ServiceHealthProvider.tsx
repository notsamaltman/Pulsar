"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ServerOff, RefreshCw, AlertTriangle } from "lucide-react";

interface ServiceHealthContextType {
  isOffline: boolean;
  checkHealth: () => Promise<void>;
}

const ServiceHealthContext = createContext<ServiceHealthContextType>({
  isOffline: false,
  checkHealth: async () => {},
});

export const useServiceHealth = () => useContext(ServiceHealthContext);

export function ServiceHealthProvider({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const checkHealth = async () => {
    try {
      const res = await fetch("/api/service-health", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.mlServiceActive) {
          setIsOffline(false);
          return;
        }
      }
      setIsOffline(true);
    } catch (error) {
      console.error("Health check error:", error);
      setIsOffline(true);
    }
  };

  const handleManualRetry = async () => {
    setIsRetrying(true);
    await checkHealth();
    setIsRetrying(false);
  };

  useEffect(() => {
    // Initial health check
    checkHealth();

    // Poll health endpoint every 10 seconds
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ServiceHealthContext.Provider value={{ isOffline, checkHealth }}>
      {/* App content locked when offline */}
      <div className={isOffline ? "pointer-events-none select-none filter blur-[2px] transition-all duration-500" : ""}>
        {children}
      </div>

      {/* Pulsar Engine Offline Overlay */}
      <AnimatePresence>
        {isOffline && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-lg bg-[#141414] border border-red-500/20 rounded-2xl p-6 sm:p-8 shadow-[0_0_80px_rgba(239,68,68,0.15)] relative overflow-hidden"
            >
              {/* Subtle top glow line */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-red-500 to-transparent opacity-60" />

              <div className="flex flex-col items-center text-center space-y-6">
                {/* Warning / Offline Icon */}
                <div className="relative">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <ServerOff className="w-8 h-8 sm:w-10 sm:h-10 text-red-400" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center animate-ping" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-2.5 h-2.5 text-black" />
                  </div>
                </div>

                {/* Header & Description */}
                <div className="space-y-2">
                  <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    Servers Currently Down
                  </h2>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed max-w-sm">
                    Our backend services are currently offline or unreachable
                  </p>
                </div>

                {/* Retry Button */}
                <button
                  onClick={handleManualRetry}
                  disabled={isRetrying}
                  className="w-full bg-white hover:bg-slate-200 text-black font-black text-xs uppercase tracking-widest py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_25px_rgba(255,255,255,0.1)] disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
                  {isRetrying ? "Rechecking Connection..." : "Retry Connection"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ServiceHealthContext.Provider>
  );
}
