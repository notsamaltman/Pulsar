import { NextRequest, NextResponse } from "next/server";
import { enqueue } from "@/lib/queue";
import { acquireUserJobLock, releaseUserJobLock } from "@/lib/redis";
import { v4 as uuidv4 } from "uuid";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  let userId: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    userId = (session?.user as Record<string, any>)?.id || null;

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

    // --- 1. FREE-TIER DAILY LIMIT CHECK ---
    let priority = 5; // Default normal priority
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstSuccessfulJobAt: true }
      });

      // Priority 1 (High) for user's first successful job, Priority 5 (Normal) for subsequent
      if (!user?.firstSuccessfulJobAt) {
        priority = 1;
      }

      // Check if user has already completed a successful job today (UTC)
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);

      const completedToday = await prisma.campaign.findFirst({
        where: {
          userId,
          createdAt: { gte: startOfToday },
          campaignLeads: { some: {} }
        }
      });

      if (completedToday) {
        return NextResponse.json(
          {
            error: "DAILY_LIMIT_REACHED",
            message: "Daily free-tier limit reached — you've already used today's free run. Try again tomorrow!"
          },
          { status: 429 }
        );
      }

      // Prevent simultaneous double-enqueue race condition
      const locked = await acquireUserJobLock(userId, 30);
      if (!locked) {
        return NextResponse.json(
          {
            error: "JOB_IN_PROGRESS",
            message: "A Pulsar run is already in progress for your account. Please wait a moment."
          },
          { status: 429 }
        );
      }
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
      priority,
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
    if (userId) {
      await releaseUserJobLock(userId);
    }
    console.error("Error enqueuing campaign build job:", error);
    const errObj = error as { code?: string; message?: string; statusCode?: number };

    if (errObj.code === "SERVER_BUSY") {
      return NextResponse.json(
        {
          error: "SERVER_BUSY",
          message: errObj.message || "Our servers are currently under high load. Please try again in a little while."
        },
        { status: 503 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { error: "Failed to enqueue job", details: errorMessage },
      { status: 500 }
    );
  }
}

