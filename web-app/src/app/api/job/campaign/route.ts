import { NextRequest, NextResponse } from "next/server";
import { enqueue } from "@/lib/queue";
import { v4 as uuidv4 } from "uuid";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id || null;

    const body = await req.json();
    const { campaignName, industry, geoTarget, targetProfile, channels } = body;

    // Basic validation matching the required fields in frontend
    if (!campaignName || !industry || !geoTarget || !targetProfile || !channels || channels.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const jobId = uuidv4();
    const job = {
      jobId,
      jobType: "campaign_build",
      jobBody: {
        ...body,
        userId,
      },
    };

    const addedJob = await enqueue(job);

    return NextResponse.json({
      success: true,
      jobId: addedJob.id,
      message: "Campaign build job enqueued successfully",
    });
  } catch (error: unknown) {
    console.error("Error enqueuing campaign build job:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { error: "Failed to enqueue job", details: errorMessage },
      { status: 500 }
    );
  }
}
