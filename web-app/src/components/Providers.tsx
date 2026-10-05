"use client";

import { SessionProvider } from "next-auth/react";
import { ServiceHealthProvider } from "./ServiceHealthProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ServiceHealthProvider>{children}</ServiceHealthProvider>
    </SessionProvider>
  );
}

