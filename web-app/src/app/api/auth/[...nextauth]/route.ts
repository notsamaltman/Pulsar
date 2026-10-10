import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// Keeping this file as thin as possible:
// - authOptions lives in @/lib/auth (no AWS SDK import there)
// - syncProfileImage is dynamically imported inside auth.ts only on first sign-in
// This means /api/auth/session cold starts never load the AWS SDK.

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
