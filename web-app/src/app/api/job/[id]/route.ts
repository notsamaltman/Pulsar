import { NextRequest, NextResponse } from "next/server";
import { Queue } from "bullmq";
import { getRedisConnection } from "@/lib/redis";

const connection = getRedisConnection();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // We need to know which queue to check. 
    // Since jobs are enqueued to 'company_build-queue', we check that.
    const queue = new Queue("company_build-queue", { connection });
    const job = await queue.getJob(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get progress and state
    const state = await job.getState();
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
