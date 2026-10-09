import { NextRequest, NextResponse } from "next/server";
import { Queue } from "bullmq";
import { getPrisma } from "@/lib/prisma";
import { createRedisClient, getGroqStatus, isGroqExhausted, withTimeout } from "@/lib/redis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function GET(req: NextRequest) {
  const { prisma, pool } = getPrisma();
  try {
    const session = await getServerSession(authOptions);
    // @ts-expect-error session.user is slightly typed differently in nextauth
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");

    const whereClause: any = { userId };
    if (companyId) {
      whereClause.companyId = companyId;
    }

    const campaigns = await prisma.campaign.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { campaignLeads: true }
        }
      }
    });

    // Fetch queue state & Groq availability to calculate real dynamic ETAs
    let waitingJobs: any[] = [];
    let groqStatus: any = null;

    const connection = createRedisClient();
    try {
      await withTimeout(connection.connect(), 4000, "Redis connect");
      const masterQueue = new Queue("master-queue", { connection });
      waitingJobs = await withTimeout(masterQueue.getWaiting(), 4000, "BullMQ getWaiting");
      groqStatus = await getGroqStatus();
      try {
        await withTimeout(masterQueue.close(), 1500, "BullMQ queue close");
      } catch {
        // ignore
      }
    } catch (e) {
      console.warn(
        "Could not query master-queue for campaign ETAs:",
        e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      );
    } finally {
      connection.disconnect();
    }

    const isGroqExhaustedFlag = isGroqExhausted(groqStatus);

    const enrichedCampaigns = campaigns.map((camp) => {
      const status = (camp.status || "queue").toLowerCase();
      const isQueued = status === "queue" || status === "queued";
      const isOngoing = status === "ongoing" || status === "running" || status === "processing";

      let etaDisplay = "~5 min";

      if (isGroqExhaustedFlag) {
        etaDisplay = "Long time";
      } else if (isQueued) {
        const queueIndex = waitingJobs.findIndex((j) => j.id === camp.id);
        const position = queueIndex >= 0 ? queueIndex + 1 : 1;
        const minTime = position * 5;
        const maxTime = position * 10;
        etaDisplay = position === 1 ? "~5-10 min" : `~${minTime}-${maxTime} min`;
      } else if (isOngoing) {
        etaDisplay = "~3-5 min";
      }

      return {
        ...camp,
        eta: etaDisplay,
        isGroqExhausted: isGroqExhaustedFlag,
        groqStatus,
      };
    });

    return NextResponse.json({ success: true, campaigns: enrichedCampaigns });
  } catch (error: unknown) {
    console.error(
      "Error fetching campaigns:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  } finally {
    await pool.end();
  }
}
