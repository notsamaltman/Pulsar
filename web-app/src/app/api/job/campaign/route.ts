import { NextRequest, NextResponse } from "next/server";
import { enqueue } from "@/lib/queue";
import { acquireUserJobLock, releaseUserJobLock, getPlatformQuota } from "@/lib/redis";
import { v4 as uuidv4 } from "uuid";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getPrisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  let userId: string | null = null;
  const { prisma, pool } = getPrisma();
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
      companyId,
      platforms
    } = body;

    const selectedPlatforms = Array.isArray(platforms) && platforms.length > 0
      ? platforms
      : (Array.isArray(channels) && channels.length > 0 ? channels : ["youtube", "instagram", "producthunt"]);

    if (!campaignName || !industry || !geoTarget || !targetProfile) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // --- 0. PLATFORM QUOTA GUARD ---
    // Check each selected platform that has a trackable quota.
    // If ALL selected platforms with quota tracking are exhausted, block the job.
    const quotaTrackedPlatforms = ["youtube", "producthunt"] as const;
    const selectedTracked = selectedPlatforms.filter((p: string) =>
      (quotaTrackedPlatforms as readonly string[]).includes(p)
    );
    if (selectedTracked.length > 0) {
      const quotaChecks = await Promise.all(
        selectedTracked.map((p: string) =>
          getPlatformQuota(p as "youtube" | "producthunt")
        )
      );
      const allExhausted = quotaChecks.every(q => !q.available);
      if (allExhausted) {
        const soonestReset = quotaChecks
          .map(q => q.resetAt)
          .filter((r): r is number => r !== null)
          .sort()[0];
        const resetLabel = soonestReset
          ? new Date(soonestReset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "later today";
        return NextResponse.json(
          {
            error: "PLATFORM_QUOTA_EXHAUSTED",
            message: `All selected platforms (${selectedTracked.join(", ")}) have hit their daily API quota. They reset around ${resetLabel}. Please try again then, or add Instagram to your selection.`,
          },
          { status: 429 }
        );
      }
    }

    // --- 1. TIER-BASED EXECUTION & DAILY LIMIT CHECK ---
    let priority = 5;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, tier: true, firstSuccessfulJobAt: true }
      });

      const isEliteTier = user?.tier === "elite" || user?.email === "panwalkarsoham@gmail.com";

      if (isEliteTier || !user?.firstSuccessfulJobAt) {
        priority = 1;
      }

      if (!isEliteTier) {
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
              message: "Daily free-tier limit reached — you've already used today's free run. Upgrade to Elite Tier for infinite runs!"
            },
            { status: 429 }
          );
        }
      }

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

    // --- 2. ENSURE USER ROW EXISTS (FK guard) ---
    // NextAuth runs in pure JWT mode with no DB adapter, so it never auto-creates
    // a row in the `users` table. The `campaigns.userId` column has a FK pointing
    // at `users.id`, so we must upsert the user before inserting the campaign.
    // The `Company` model has no such FK (bare String? field), which is why company
    // creation never hit this error.
    if (userId) {
      const sessionUser = session?.user as Record<string, any>;
      const sessionEmail: string | null = sessionUser?.email ?? null;

      try {
        // Guard against duplicate-email conflicts: if a row already exists with
        // this email but a different id (e.g. re-authed with new OAuth subject),
        // adopt the canonical row's id so the FK is valid.
        // Note: the JWT callback now also resolves this at sign-in, so this
        // should rarely trigger — it's a safety net for existing mismatched rows.
        if (sessionEmail) {
          const existing = await prisma.user.findUnique({
            where: { email: sessionEmail },
            select: { id: true }
          });
          if (existing && existing.id !== userId) {
            console.warn(
              `[campaign] userId mismatch for ${sessionEmail}: JWT has ${userId}, DB has ${existing.id}. Adopting DB id.`
            );
            userId = existing.id;
          }
        }

        await prisma.user.upsert({
          where: { id: userId },
          update: {},  // row exists — nothing to change
          create: {
            id: userId,
            name: sessionUser?.name ?? null,
            email: sessionEmail,
            image: sessionUser?.image ?? null,
          },
        });
      } catch (userErr) {
        // Non-fatal: log and fall back to no userId so the campaign still saves.
        console.error(
          "[-] User upsert warning (falling back to null userId):",
          userErr instanceof Error ? userErr.message : String(userErr)
        );
        userId = null;
      }
    }

    // --- 3. CREATE CAMPAIGN RECORD ---
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
        status: "queue",
        platforms: selectedPlatforms,
      },
    });
    console.log(`[+] Saved Campaign '${campaignName}' (${jobId}) to Prisma database.`);

    // --- 4. ENQUEUE ---
    const job = {
      jobId,
      jobType: "master",
      priority,
      jobBody: {
        ...body,
        platforms: selectedPlatforms,
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
      await releaseUserJobLock(userId).catch(() => {});
    }
    console.error(
      "Error enqueuing campaign build job:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
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
  } finally {
    await pool.end();
  }
}
