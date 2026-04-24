"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { AuthLoading } from "./AuthLoading";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [isInitializing, setIsInitializing] = useState(true);
  const [shouldShowLoader, setShouldShowLoader] = useState(false);
  const [isLikelyLoggedIn, setIsLikelyLoggedIn] = useState(false);

  useEffect(() => {
    // This only runs on the client
    const likelyLoggedIn = localStorage.getItem("pulsar_logged_in") === "true";
    setIsLikelyLoggedIn(likelyLoggedIn);
    
    if (likelyLoggedIn && status === "loading") {
      setShouldShowLoader(true);
    }
  }, [status]);

  useEffect(() => {
    if (status === "authenticated") {
      localStorage.setItem("pulsar_logged_in", "true");
      setShouldShowLoader(false);
      setIsInitializing(false);
    } else if (status === "unauthenticated") {
      localStorage.removeItem("pulsar_logged_in");
      setShouldShowLoader(false);
      setIsInitializing(false);
    }
  }, [status]);

  // Use the safe client-side state for the loader check
  if (shouldShowLoader || (status === "loading" && isLikelyLoggedIn)) {
    return <AuthLoading />;
  }

  return <>{children}</>;
}
