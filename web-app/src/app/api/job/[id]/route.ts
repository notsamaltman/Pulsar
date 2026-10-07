import { NextRequest, NextResponse } from "next/server";
import { Queue } from "bullmq";
import { getRedisConnection, ensureRedisConnected, withTimeout } from "@/lib/redis";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const connection = getRedisConnection();
    await ensureRedisConnected(connection);
    const queue = new Queue("company_build-queue", { connection });
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
  } catch (error) {
    console.error("Error fetching job status:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
