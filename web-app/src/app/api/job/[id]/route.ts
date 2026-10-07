import { NextRequest, NextResponse } from "next/server";
import { Queue } from "bullmq";
import { createRedisClient, withTimeout } from "@/lib/redis";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = createRedisClient();
  let queue: Queue | null = null;
  try {
    const { id } = await params;

    await withTimeout(connection.connect(), 4000, "Redis connect");
    queue = new Queue("company_build-queue", { connection });
    const job = await withTimeout(queue.getJob(id), 4000, "BullMQ getJob");

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get progress and state
    const state = await withTimeout(job.getState(), 4000, "BullMQ getState");
    const progress = job.progress;

    return NextResponse.json({
      id: job.id,
      state,
      progress, // This will contain our {status, message, result}
      data: job.data,
    });
  } catch (error: unknown) {
    console.error("Error fetching job status:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  } finally {
    if (queue) {
      try { await withTimeout(queue.close(), 1500, "BullMQ queue close"); } catch {}
    }
    connection.disconnect();
  }
}
