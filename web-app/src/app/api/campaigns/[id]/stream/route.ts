import { NextRequest } from "next/server";
import { Queue } from "bullmq";
import { getPrisma } from "@/lib/prisma";
import { createRedisClient, withTimeout } from "@/lib/redis";

export const dynamic = 'force-dynamic';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { prisma, pool } = getPrisma();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Per-request Redis connection for BullMQ
      let queue: Queue | null = null;
      let redisConnection = createRedisClient();
      try {
        await withTimeout(redisConnection.connect(), 4000, "Redis connect");
        queue = new Queue("master-queue", { connection: redisConnection });
      } catch (redisErr) {
        console.warn(
          "SSE could not connect to Redis:",
          redisErr instanceof Error ? `${redisErr.name}: ${redisErr.message}` : String(redisErr)
        );
        redisConnection.disconnect();
        redisConnection = null as any;
      }

      let isClosed = false;
      let interval: ReturnType<typeof setInterval> | undefined;

      const cleanupRedis = async () => {
        if (queue) {
          try { await withTimeout(queue.close(), 1500, "BullMQ queue close"); } catch {}
          queue = null;
        }
        if (redisConnection) {
          try { redisConnection.disconnect(); } catch {}
          redisConnection = null as any;
        }
      };

      const cleanupAll = async () => {
        await cleanupRedis();
        try { await pool.end(); } catch {}
      };

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
            await cleanupAll();
          }
        } catch (err) {
          console.error(
            "SSE streaming error:",
            err instanceof Error ? `${err.name}: ${err.message}` : String(err)
          );
        }
      };

      await poll();
      if (!isClosed) {
        interval = setInterval(poll, 2000);
      }

      req.signal.addEventListener("abort", async () => {
        if (interval) clearInterval(interval);
        if (!isClosed) {
          isClosed = true;
          try { controller.close(); } catch {}
        }
        await cleanupAll();
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
