import { NextRequest, NextResponse } from "next/server";
import { enqueue } from "@/lib/queue";
import { v4 as uuidv4 } from "uuid";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id || null;

    const body = await req.json();
    const { 
      campaignName, 
      goalType,
      industry, 
      geoTarget, 
      budget,
      targetProfile, 
      focus,
      minFollowers,
      exclusions,
      b2bSignals,
      minEngagement,
      contentType,
      channels,
      tone,
      sequence,
      companyId 
    } = body;

    // Basic validation matching the required fields in frontend
    if (!campaignName || !industry || !geoTarget || !targetProfile || !channels || channels.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const jobId = uuidv4();

    // Create Campaign record in database first so campaignId FK exists
    try {
      await prisma.campaign.create({
        data: {
          id: jobId,
          name: campaignName,
          goalType: goalType || "Lead Generation",
          industry,
          geoTarget,
          budget: budget || "Organic Outreach",
          targetProfile,
          focus: focus || "B2B",
          minFollowers: minFollowers ? String(minFollowers) : null,
          exclusions: exclusions || null,
          b2bSignals: Array.isArray(b2bSignals) ? b2bSignals : [],
          minEngagement: minEngagement ? String(minEngagement) : null,
          contentType: contentType || null,
          channels: Array.isArray(channels) ? channels : [],
          tone: tone || "Professional",
          sequence: sequence || "3 Touchpoints",
          companyId: companyId || null,
          userId: userId || null,
        },
      });
      console.log(`[+] Saved Campaign '${campaignName}' (${jobId}) to Prisma database.`);
    } catch (dbErr) {
      console.error("[-] Error saving Campaign to Prisma database:", dbErr);
    }

    const job = {
      jobId,
      jobType: "master",
      jobBody: {
        ...body,
        campaignId: jobId,
        userId,
      },
    };

    const addedJob = await enqueue(job);

    return NextResponse.json({
      success: true,
      jobId: addedJob.id,
      campaignId: jobId,
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
