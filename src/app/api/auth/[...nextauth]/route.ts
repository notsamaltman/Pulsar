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
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      const customToken = token as { accessToken?: string; refreshToken?: string };
      // @ts-expect-error - Session type doesn't have these properties
      session.accessToken = customToken.accessToken;
      // @ts-expect-error - Session type doesn't have these properties
      session.refreshToken = customToken.refreshToken;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.image && user.image.includes("googleusercontent.com")) {
        try {
          const response = await fetch(user.image);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          const filename = `profile/${user.id}.png`;
          
          await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME!,
            Key: filename,
            Body: buffer,
            ContentType: "image/png",
          }));
          
          const s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
          
          await prisma.user.update({
            where: { id: user.id },
            data: { image: s3Url },
          });
        } catch (error) {
          console.error("Error uploading profile picture to S3:", error);
        }
      }
    }
  }
});

export { handler as GET, handler as POST };
