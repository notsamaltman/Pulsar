import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Queue } from "bullmq";
import { getRedisConnection, ensureRedisConnected, withTimeout } from "@/lib/redis";

export const dynamic = 'force-dynamic';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      let queue: Queue | null = null;
      try {
        const connection = getRedisConnection();
        await ensureRedisConnected(connection);
        queue = new Queue("master-queue", { connection });
      } catch (redisErr) {
        console.warn("SSE could not connect to Redis:", redisErr);
      }
      let isClosed = false;
      let interval: ReturnType<typeof setInterval> | undefined;

      const sendEvent = (data: any) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
        }
      };

      const poll = async () => {
        try {
          if (isClosed) {
            if (interval) clearInterval(interval);
            return;
          }

          // Fetch job progress
          let jobState = "unknown";
          let jobProgress = null;

          if (queue) {
            const job = await withTimeout(queue.getJob(id), 4000, "BullMQ getJob");
            if (job) {
              jobState = await withTimeout(job.getState(), 4000, "BullMQ getState");
              jobProgress = job.progress;
            }
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
            if (interval) clearInterval(interval);
            if (!isClosed) {
              isClosed = true;
              try { controller.close(); } catch {}
            }
          }
        } catch (err) {
          console.error("SSE streaming error:", err);
        }
      };

      await poll();
      if (!isClosed) {
        interval = setInterval(poll, 2000);
      }

      req.signal.addEventListener("abort", () => {
        if (interval) clearInterval(interval);
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
