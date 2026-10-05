// lib/queue.ts
import { Queue } from 'bullmq';
import { getRedisConnection } from './redis';

export interface Job {
  jobId: string;
  jobType: string;
  jobBody: Record<string, unknown>;
  priority?: number; // 1 = High (first job), 5 = Normal (subsequent), 10 = Low (background)
}

const KNOWN_QUEUES = ['master-queue', 'company_build-queue'];

/**
 * Checks total number of jobs currently admitted-but-not-completed across queues.
 * Counts waiting, active, and delayed jobs without loading full job objects.
 */
export async function getQueueTotalJobs(): Promise<number> {
  const connection = getRedisConnection();
  let total = 0;
  for (const qName of KNOWN_QUEUES) {
    const q = new Queue(qName, { connection });
    try {
      const counts = await q.getJobCounts('waiting', 'active', 'delayed');
      total += (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
    } catch (e) {
      console.error(`Error counting jobs for queue ${qName}:`, e);
    } finally {
      await q.close();
    }
  }
  return total;
}

/**
 * Universal enqueue function to add jobs to specific queues based on jobType.
 * Enforces native BullMQ priority, retention policy, and max capacity limit (500).
 */
export async function enqueue(job: Job) {
  const { jobId, jobType, jobBody, priority = 5 } = job;
  const maxCapacity = parseInt(process.env.PULSAR_MAX_QUEUE_SIZE || '500', 10);

  const currentCount = await getQueueTotalJobs();
  if (currentCount >= maxCapacity) {
    const error = new Error("Our servers are currently under high load. Please try again in a little while.") as Error & { code?: string; statusCode?: number };
    error.code = "SERVER_BUSY";
    error.statusCode = 503;
    throw error;
  }

  const connection = getRedisConnection();
  const queueName = `${jobType}-queue`;
  const requestQueue = new Queue(queueName, { connection });

  try {
    const addedJob = await requestQueue.add(
      `${jobId}-${jobType}-${Date.now()}`,
      { ...jobBody, jobId, jobType },
      {
        priority, // Native BullMQ priority: 1 is higher priority than 5
        removeOnComplete: {
          age: 3600, // keep completed jobs for 1 hour
          count: 100, // max 100 completed jobs in Redis
        },
        removeOnFail: {
          age: 86400, // keep failed jobs for 24 hours
          count: 500,
        },
      }
    );

    console.log(`[+] Enqueued job ${jobId} on ${queueName} with priority ${priority}. Current total queue count: ${currentCount + 1}/${maxCapacity}`);
    return addedJob;
  } finally {
    await requestQueue.close();
  }
}

export default enqueue;