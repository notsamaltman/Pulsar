import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Queue } from "bullmq";
import { getRedisConnection, getGroqStatus, isGroqExhausted } from "@/lib/redis";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");

    const whereClause: any = {};
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

    try {
      const connection = getRedisConnection();
      const masterQueue = new Queue("master-queue", { connection });
      waitingJobs = await masterQueue.getWaiting();
      groqStatus = await getGroqStatus();
      await masterQueue.close();
    } catch (e) {
      console.warn("Could not query master-queue for campaign ETAs:", e);
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
    console.error("Error fetching campaigns:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
