import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getPrisma } from "@/lib/prisma";
import { withTimeout } from "@/lib/redis";

// ---------------------------------------------------------------------------
// authOptions lives here, NOT in the route file.
//
// The route file (api/auth/[...nextauth]/route.ts) also imports syncProfileImage
// which pulls in the entire AWS SDK. Keeping authOptions here means that
// /api/auth/session — which only needs JWT decode + the session/jwt callbacks —
// never pays the AWS SDK module parse cost.
// ---------------------------------------------------------------------------

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // Only runs on initial sign-in — account + user only present then.
      // Every subsequent /api/auth/session call just returns the cached token.
      if (account && user) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;

        const { prisma } = getPrisma();
        try {
          const dbUser = await withTimeout(
            prisma.user.findUnique({
              where: { id: user.id },
              select: { id: true, email: true, tier: true },
            }),
            8000,
            "JWT sign-in user lookup"
          );

          let canonicalId = user.id;
          if (!dbUser && user.email) {
            const byEmail = await withTimeout(
              prisma.user.findUnique({
                where: { email: user.email },
                select: { id: true, tier: true },
              }),
              8000,
              "JWT sign-in email lookup"
            );
            if (byEmail) {
              canonicalId = byEmail.id;
              token.tier = byEmail.tier || "free";
            }
          }

          token.id = canonicalId;

          const resolvedUser =
            dbUser ??
            (canonicalId !== user.id
              ? await withTimeout(
                  prisma.user.findUnique({
                    where: { id: canonicalId },
                    select: { email: true, tier: true },
                  }),
                  8000,
                  "JWT sign-in resolved user"
                )
              : null);

          if (resolvedUser) {
            if (
              resolvedUser.email === "panwalkarsoham@gmail.com" &&
              resolvedUser.tier !== "elite"
            ) {
              prisma.user
                .update({ where: { id: canonicalId }, data: { tier: "elite" } })
                .catch((e: unknown) => {
                  console.warn(
                    "Elite tier update failed:",
                    e instanceof Error ? e.message : String(e)
                  );
                });
              token.tier = "elite";
            } else {
              token.tier = resolvedUser.tier || "free";
            }
          } else {
            token.id = user.id;
            token.tier = "free";
          }
        } catch (dbError) {
          console.warn(
            "Skipping JWT user/tier lookup:",
            dbError instanceof Error
              ? `${dbError.name}: ${dbError.message}`
              : String(dbError)
          );
          token.id = user.id;
        }

        // Profile image sync — only on first sign-in, lazy-import AWS SDK
        // so it never bloats the session-check cold-start cost.
        try {
          const { syncProfileImage } = await import("@/lib/syncProfileImage");
          const updatedImage = await Promise.race([
            syncProfileImage(user.id, user.image),
            new Promise<string | null | undefined>((_, reject) =>
              setTimeout(
                () => reject(new Error("Profile image sync timed out")),
                8000
              )
            ),
          ]);
          token.image = updatedImage;
        } catch (syncError) {
          console.warn(
            "Skipping profile image sync:",
            syncError instanceof Error
              ? `${syncError.name}: ${syncError.message}`
              : String(syncError)
          );
          token.image = user.image;
        }
      }

      return token;
    },

    async session({ session, token }) {
      const customToken = token as {
        accessToken?: string;
        refreshToken?: string;
        id?: string;
        image?: string;
        tier?: string;
        email?: string;
      };

      if (session.user) {
        // @ts-expect-error - Session user type doesn't have id
        session.user.id = customToken.id;
        session.user.image = customToken.image || session.user.image;
        // @ts-expect-error - Session user type doesn't have tier
        session.user.tier =
          customToken.email === "panwalkarsoham@gmail.com"
            ? "elite"
            : customToken.tier || "free";
      }

      // @ts-expect-error - Session type doesn't have these properties
      session.accessToken = customToken.accessToken;
      // @ts-expect-error - Session type doesn't have these properties
      session.refreshToken = customToken.refreshToken;

      return session;
    },
  },

  events: {
    async createUser({ user }) {
      try {
        const { syncProfileImage } = await import("@/lib/syncProfileImage");
        await withTimeout(
          syncProfileImage(user.id, user.image),
          8000,
          "createUser image sync"
        );
      } catch (syncError) {
        console.warn(
          "Skipping createUser image sync:",
          syncError instanceof Error
            ? `${syncError.name}: ${syncError.message}`
            : String(syncError)
        );
      }
    },
  },
};
