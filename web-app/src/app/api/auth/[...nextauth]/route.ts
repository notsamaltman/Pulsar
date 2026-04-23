import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Helper to sync profile picture to S3
async function syncProfileImage(userId: string, currentImage: string | null | undefined) {
  if (currentImage && currentImage.includes("googleusercontent.com")) {
    try {
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
          ACL: "public-read", // Try setting public access
        }));
      } catch (aclError) {
        console.warn("Failed to set ACL: public-read, bucket might not support it. Trying without ACL.", aclError);
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: filename,
          Body: buffer,
          ContentType: "image/png",
        }));
      }
      
      const s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${filename}`;
      
      console.log(`Successfully synced image for user ${userId} to ${s3Url}`);
      
      await prisma.user.update({
        where: { id: userId },
        data: { image: s3Url },
      });
      return s3Url;
    } catch (error) {
      console.error("Error syncing profile picture to S3:", error);
    }
  }
  return currentImage;
}

const handler = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
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
      if (account && user) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.id = user.id;
        
        // Sync image if it's still from Google OR if it's missing but available from the login
        // user.image here comes from the DB (via Adapter) or the provider profile
        const updatedImage = await syncProfileImage(user.id, user.image);
        token.image = updatedImage;
      }
      return token;
    },
    async session({ session, token }) {
      const customToken = token as { 
        accessToken?: string; 
        refreshToken?: string;
        id?: string;
        image?: string;
      };
      
      if (session.user) {
        // @ts-expect-error - Session user type doesn't have id
        session.user.id = customToken.id;
        session.user.image = customToken.image || session.user.image;
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
      await syncProfileImage(user.id, user.image);
    }
  }
});

export { handler as GET, handler as POST };
