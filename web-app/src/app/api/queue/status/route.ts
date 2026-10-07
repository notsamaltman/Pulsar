import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import { getRedisConnection, getGroqStatus, enrichGroqStatus, ensureRedisConnected, withTimeout } from '@/lib/redis';
import { getQueueTotalJobs } from '@/lib/queue';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    const connection = getRedisConnection();
    await ensureRedisConnected(connection);
    const masterQueue = new Queue('master-queue', { connection });

    const totalWaiting = await withTimeout(masterQueue.getWaitingCount(), 4000, 'BullMQ getWaitingCount');
    const totalActive = await withTimeout(masterQueue.getActiveCount(), 4000, 'BullMQ getActiveCount');
    const totalQueueSize = await getQueueTotalJobs();
    const groqStatus = enrichGroqStatus(await getGroqStatus());

    let jobDetail = null;

    if (jobId) {
      const job = await masterQueue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        const progress = job.progress as any;

        let queuePosition = 0;
        let estimatedEtaSeconds = 0;

        if (state === 'waiting') {
          const waitingJobs = await masterQueue.getWaiting();
          const index = waitingJobs.findIndex(j => j.id === job.id);
          queuePosition = index >= 0 ? index + 1 : 1;
          // 5-10 mins per job in front of it (using 7 mins / 420s)
          estimatedEtaSeconds = queuePosition * 420;
        } else if (state === 'active') {
          estimatedEtaSeconds = 300; // active job has ~5 mins remaining
        }

        jobDetail = {
          id: job.id,
          state,
          progress: progress || null,
          queuePosition,
          estimatedEtaSeconds,
        };
      }
    }

    try {
      await withTimeout(masterQueue.close(), 1500, 'BullMQ queue close');
    } catch {
      // ignore
    }

    return NextResponse.json({
      success: true,
      totalWaiting,
      totalActive,
      totalQueueSize,
      maxCapacity: parseInt(process.env.PULSAR_MAX_QUEUE_SIZE || '500', 10),
      groqStatus,
      jobDetail,
    });
  } catch (error: any) {
    console.error('Error fetching queue status:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
