import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Queue } from "bullmq";
import { getRedisConnection } from "@/lib/redis";

const connection = getRedisConnection();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Fetch Campaign & associated leads from Prisma DB
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        campaignLeads: {
          include: {
            lead: true
          }
        }
      }
    });

    // 2. Fetch job status from BullMQ master-queue if running
    let jobProgress: any = null;
    let jobState: string = "completed";

    try {
      const queue = new Queue("master-queue", { connection });
      const job = await queue.getJob(id);

      if (job) {
        jobState = await job.getState();
        jobProgress = job.progress;
      }
    } catch (redisErr) {
      console.warn("Could not fetch BullMQ job status:", redisErr);
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
    console.error("Error fetching campaign detail:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing campaign ID" }, { status: 400 });
    }

    // Delete campaign from database
    // FK relationship onDelete: Cascade on CampaignLead deletes junction records while preserving Lead table rows!
    await prisma.campaign.delete({
      where: { id }
    });

    // Also attempt to remove job from BullMQ queue if present
    try {
      const queue = new Queue("master-queue", { connection });
      const job = await queue.getJob(id);
      if (job) {
        await job.remove();
      }
    } catch (redisErr) {
      console.warn("Could not remove BullMQ job:", redisErr);
    }

    return NextResponse.json({
      success: true,
      message: `Campaign ${id} and campaign_leads associations deleted successfully. Leads preserved.`
    });
  } catch (error: unknown) {
    console.error("Error deleting campaign:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
