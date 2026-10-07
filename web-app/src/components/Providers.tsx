"use client";

import { SessionProvider } from "next-auth/react";
import { ServiceHealthProvider } from "./ServiceHealthProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      <ServiceHealthProvider>{children}</ServiceHealthProvider>
    </SessionProvider>
  );
}

