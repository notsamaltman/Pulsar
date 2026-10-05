"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ServerOff, RefreshCw } from "lucide-react";

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
      {/* App content remains fully interactive */}
      <div>
        {children}
      </div>

      {/* Non-intrusive Engine Offline Side Badge */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-[#181818]/95 border border-red-500/30 text-white px-3.5 py-2.5 rounded-full shadow-[0_4px_20px_rgba(239,68,68,0.2)] backdrop-blur-md text-xs font-medium"
          >
            <div className="relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping absolute" />
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            </div>
            <div className="flex items-center gap-1.5 text-red-300 font-semibold">
              <ServerOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Engine Offline</span>
              <span className="sm:hidden">Offline</span>
            </div>
            <button
              onClick={handleManualRetry}
              disabled={isRetrying}
              className="ml-1 pl-2 border-l border-[#333] text-[10px] uppercase font-bold text-slate-400 hover:text-white flex items-center gap-1 transition-colors disabled:opacity-50"
              title="Recheck connection to ML service"
            >
              <RefreshCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
              <span>{isRetrying ? "Checking..." : "Retry"}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </ServiceHealthContext.Provider>
  );
}

