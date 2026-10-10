import { NextRequest, NextResponse } from "next/server";
import { Queue } from "bullmq";
import { getPrisma } from "@/lib/prisma";
import { createRedisClient, withTimeout } from "@/lib/redis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { prisma } = getPrisma();
  try {
    const { id } = await params;

    const session = await getServerSession(authOptions);
    // @ts-expect-error session.user is slightly typed differently in nextauth
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Fetch Campaign & associated leads from Prisma DB (scoped to owner)
    const campaign = await prisma.campaign.findFirst({
      where: { id, userId },
      include: {
        campaignLeads: {
          include: {
            lead: true
          }
        }
      }
    });

    // 2. Fetch job status from BullMQ — BullMQ Queue must own its connection.
    let jobProgress: any = null;
    let jobState: string = "completed";

    const connection = createRedisClient();
    try {
      await withTimeout(connection.connect(), 4000, "Redis connect");
      const queue = new Queue("master-queue", { connection });
      const job = await withTimeout(queue.getJob(id), 4000, "BullMQ getJob");

      if (job) {
        jobState = await withTimeout(job.getState(), 4000, "BullMQ getState");
        jobProgress = job.progress;
      }
      try {
        await withTimeout(queue.close(), 1500, "BullMQ queue close");
      } catch {
        // ignore
      }
    } catch (redisErr) {
      console.warn(
        "Could not fetch BullMQ job status:",
        redisErr instanceof Error ? `${redisErr.name}: ${redisErr.message}` : String(redisErr)
      );
    } finally {
      connection.disconnect();
    }

    // 3. Format leads by platform
    const leads = campaign?.campaignLeads.map(cl => ({
      campaignLeadId: `${cl.campaignId}_${cl.leadId}`,
      status: cl.status,
      icpScore: cl.icpScore,
      contactedAt: cl.contactedAt,
      responseReceived: cl.responseReceived,
      ...cl.lead
    })) || [];

    return NextResponse.json({
      success: true,
      campaign: campaign || { id, name: "Active Campaign" },
      jobState,
      jobProgress,
      leadsCount: leads.length,
      leads
    });
  } catch (error: unknown) {
    console.error(
      "Error fetching campaign detail:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { prisma } = getPrisma();
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing campaign ID" }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    // @ts-expect-error session.user is slightly typed differently in nextauth
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership before deleting
    const existing = await prisma.campaign.findFirst({ where: { id, userId } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Delete campaign from database
    // FK relationship onDelete: Cascade on CampaignLead deletes junction records while preserving Lead table rows
    await prisma.campaign.delete({ where: { id } });

    // Also attempt to remove job from BullMQ queue if present — BullMQ owns its connection.
    const connection = createRedisClient();
    try {
      await withTimeout(connection.connect(), 4000, "Redis connect");
      const queue = new Queue("master-queue", { connection });
      const job = await withTimeout(queue.getJob(id), 4000, "BullMQ getJob");
      if (job) {
        await withTimeout(job.remove(), 4000, "BullMQ job.remove");
      }
      try {
        await withTimeout(queue.close(), 1500, "BullMQ queue close");
      } catch {
        // ignore
      }
    } catch (redisErr) {
      console.warn(
        "Could not remove BullMQ job:",
        redisErr instanceof Error ? `${redisErr.name}: ${redisErr.message}` : String(redisErr)
      );
    } finally {
      connection.disconnect();
    }

    return NextResponse.json({
      success: true,
      message: `Campaign ${id} and campaign_leads associations deleted successfully. Leads preserved.`
    });
  } catch (error: unknown) {
    console.error(
      "Error deleting campaign:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
