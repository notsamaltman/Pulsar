import React, { createContext, useContext, useEffect, useState } from "react";

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

  useEffect(() => {
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);


  return (
    <ServiceHealthContext.Provider value={{ isOffline, checkHealth }}>
      {children}
    </ServiceHealthContext.Provider>
  );
}

