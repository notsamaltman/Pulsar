import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Queue } from "bullmq";
import { getRedisConnection } from "@/lib/redis";

export const dynamic = 'force-dynamic';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const connection = getRedisConnection();
      const queue = new Queue("master-queue", { connection });
      let isClosed = false;

      const sendEvent = (data: any) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
        }
      };

      // Poll database and queue progress every 2 seconds
      const interval = setInterval(async () => {
        try {
          if (isClosed) {
            clearInterval(interval);
            return;
          }

          // Fetch job progress
          let jobState = "unknown";
          let jobProgress = null;

          const job = await queue.getJob(id);
          if (job) {
            jobState = await job.getState();
            jobProgress = job.progress;
          }

          // Fetch leads from database
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

          const leads = campaign?.campaignLeads.map(cl => ({
            campaignLeadId: `${cl.campaignId}_${cl.leadId}`,
            status: cl.status,
            icpScore: cl.icpScore,
            ...cl.lead
          })) || [];

          const campObj = campaign as any;
          sendEvent({
            campaignId: id,
            jobState,
            jobProgress,
            status: campObj?.status || (jobState === "active" ? "ongoing" : jobState === "completed" ? "complete" : "queue"),
            platforms: campObj?.platforms || [],
            leadsCount: leads.length,
            leads,
            timestamp: Date.now()
          });

          if (jobState === "completed" || jobState === "failed") {
            // Close stream after terminal state
            clearInterval(interval);
            if (!isClosed) {
              isClosed = true;
              try { controller.close(); } catch {}
            }
          }
        } catch (err) {
          console.error("SSE streaming error:", err);
        }
      }, 2000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        if (!isClosed) {
          isClosed = true;
          try { controller.close(); } catch {}
        }
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
