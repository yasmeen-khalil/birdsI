"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

/** Ends the browser session after the account is deleted, so it is not recreated on the next visit. */
export function EndSession() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  useEffect(() => {
    if (isLoaded && isSignedIn) void signOut({ redirectUrl: "/deleted" });
  }, [isLoaded, isSignedIn, signOut]);
  return null;
}
