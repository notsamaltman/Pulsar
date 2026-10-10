// Isolated module — only loaded via dynamic import() on first sign-in.
// Keeps the AWS SDK out of the /api/auth/session cold-start path.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getPrisma } from "@/lib/prisma";

export async function syncProfileImage(
  userId: string,
  currentImage: string | null | undefined
): Promise<string | null | undefined> {
  if (!currentImage || !currentImage.includes("googleusercontent.com")) {
    return currentImage;
  }

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

    // Try with ACL first; silently fall back if the bucket doesn't support it.
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: filename,
          Body: buffer,
          ContentType: "image/png",
          ACL: "public-read",
        })
      );
    } catch {
      // ACL not supported on this bucket — upload without it.
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: filename,
          Body: buffer,
          ContentType: "image/png",
        })
      );
    }

    const s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${filename}`;
    console.log(`[+] Synced profile image for user ${userId} → ${s3Url}`);

    // Update the user's image in DB — upsert so we don't fail if the row
    // doesn't exist yet (NextAuth JWT mode never auto-creates users).
    const { prisma } = getPrisma();
    try {
      await prisma.user.upsert({
        where: { id: userId },
        update: { image: s3Url },
        create: { id: userId, image: s3Url },
      });
    } catch (updateErr) {
      console.warn(
        "[syncProfileImage] DB upsert failed:",
        updateErr instanceof Error ? updateErr.message : String(updateErr)
      );
    }

    return s3Url;
  } catch (error) {
    console.error(
      "[syncProfileImage] Error:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return currentImage;
  }
}
