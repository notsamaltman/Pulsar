import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getPrisma } from "@/lib/prisma";
import { withTimeout } from "@/lib/redis";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Helper to sync profile picture to S3.
// S3Client is created inside the function so it is NOT constructed at module scope
// (AWS SDK v3 constructor overhead is non-trivial — avoid paying it on cold starts
// where no image sync is needed).
async function syncProfileImage(userId: string, currentImage: string | null | undefined) {
  if (currentImage && currentImage.includes("googleusercontent.com")) {
    try {
      const s3Client = new S3Client({
        region: process.env.AWS_REGION!,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      const response = await fetch(currentImage);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const filename = `profile/${userId}.png`;

      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: filename,
          Body: buffer,
          ContentType: "image/png",
          ACL: "public-read",
        }));
      } catch (aclError) {
        console.warn(
          "Failed to set ACL: public-read, bucket might not support it. Trying without ACL.",
          aclError instanceof Error ? `${aclError.name}: ${aclError.message}` : String(aclError)
        );
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: filename,
          Body: buffer,
          ContentType: "image/png",
        }));
      }

      const s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${filename}`;
      console.log(`Successfully synced image for user ${userId} to ${s3Url}`);

      const { prisma } = getPrisma();
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { image: s3Url },
        });
      } catch (updateErr) {
        console.warn("Failed to update user image in DB:", updateErr instanceof Error ? updateErr.message : String(updateErr));
      }
      return s3Url;
    } catch (error) {
      console.error(
        "Error syncing profile picture to S3:",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      );
    }
  }
  return currentImage;
}

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
          response_type: "code"
        }
      }
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
      // ----------------------------------------------------------------
      // Only runs on initial sign-in (account + user are only present then).
      // Subsequent calls return the cached token immediately — no DB hit.
      // ----------------------------------------------------------------
      if (account && user) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;

        // Fetch tier once at sign-in and store it in the token.
        // Also resolve the canonical DB user id: if a row already exists
        // with this email but a different id (re-auth / id mismatch), adopt
        // the canonical id so session.user.id always matches campaigns.userId.
        const { prisma } = getPrisma();
        try {
          const dbUser = await withTimeout(
            prisma.user.findUnique({
              where: { id: user.id },
              select: { id: true, email: true, tier: true }
            }),
            8000,
            "JWT sign-in user lookup"
          );

          // Check for email-based canonical id mismatch
          let canonicalId = user.id;
          if (!dbUser && user.email) {
            const byEmail = await withTimeout(
              prisma.user.findUnique({
                where: { email: user.email },
                select: { id: true, tier: true }
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

          const resolvedUser = dbUser ?? (canonicalId !== user.id ? await withTimeout(
            prisma.user.findUnique({ where: { id: canonicalId }, select: { email: true, tier: true } }),
            8000,
            "JWT sign-in resolved user"
          ) : null);

          if (resolvedUser) {
            if (resolvedUser.email === "panwalkarsoham@gmail.com" && resolvedUser.tier !== "elite") {
              prisma.user.update({
                where: { id: canonicalId },
                data: { tier: "elite" }
              }).catch((e: unknown) => {
                console.warn("Elite tier update failed:", e instanceof Error ? e.message : String(e));
              });
              token.tier = "elite";
            } else {
              token.tier = resolvedUser.tier || "free";
            }
          } else {
            // No DB row yet — will be created on first campaign enqueue
            token.id = user.id;
            token.tier = "free";
          }
        } catch (dbError) {
          console.warn(
            "Skipping JWT user/tier lookup:",
            dbError instanceof Error ? `${dbError.name}: ${dbError.message}` : String(dbError)
          );
          token.id = user.id;
        }

        // Profile image sync — only on first sign-in
        try {
          const updatedImage = await Promise.race([
            syncProfileImage(user.id, user.image),
            new Promise<string | null | undefined>((_, reject) =>
              setTimeout(() => reject(new Error("Profile image sync timed out")), 8000)
            ),
          ]);
          token.image = updatedImage;
        } catch (syncError) {
          console.warn(
            "Skipping profile image sync:",
            syncError instanceof Error ? `${syncError.name}: ${syncError.message}` : String(syncError)
          );
          token.image = user.image;
        }
      }

      // Subsequent requests: token already has id and tier — return immediately.
      return token;
    },
    async session({ session, token }) {
      const customToken = token as {
        accessToken?: string;
        refreshToken?: string;
        id?: string;
        image?: string;
        tier?: string;
      };

      if (session.user) {
        // @ts-expect-error - Session user type doesn't have id
        session.user.id = customToken.id;
        session.user.image = customToken.image || session.user.image;
        // @ts-expect-error - Session user type doesn't have tier
        session.user.tier = customToken.email === "panwalkarsoham@gmail.com" ? "elite" : (customToken.tier || "free");
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
        await withTimeout(
          syncProfileImage(user.id, user.image),
          8000,
          "createUser image sync"
        );
      } catch (syncError) {
        console.warn(
          "Skipping createUser image sync:",
          syncError instanceof Error ? `${syncError.name}: ${syncError.message}` : String(syncError)
        );
      }
    }
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
