// lib/queue.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createRedisClient, withTimeout } from './redis';

export interface Job {
  jobId: string;
  jobType: string;
  jobBody: Record<string, unknown>;
  priority?: number; // 1 = High (first job), 5 = Normal (subsequent), 10 = Low (background)
}

const KNOWN_QUEUES = ['master-queue', 'company_build-queue'];

async function safeCloseQueue(q: Queue) {
  try {
    await withTimeout(q.close(), 1500, 'BullMQ queue close');
  } catch (e) {
    console.warn('Queue close skipped:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
}

/**
 * Enqueues a job. Runs the capacity check and the add on a single Redis connection.
 *
 * Pass `existingConnection` to reuse an already-connected IORedis client from the
 * calling request handler (saves one TCP handshake). When omitted, a new connection
 * is created and torn down internally as before.
 */
export async function enqueue(job: Job, existingConnection?: IORedis) {
  const { jobId, jobType, jobBody, priority = 5 } = job;
  const maxCapacity = parseInt(process.env.PULSAR_MAX_QUEUE_SIZE || '500', 10);

  // Use the caller's connection if provided, otherwise open our own.
  const ownsConnection = !existingConnection;
  const connection = existingConnection ?? createRedisClient();

  try {
    if (ownsConnection) {
      await withTimeout(connection.connect(), 4000, 'Redis connect');
    }

    // --- Capacity check ---
    let currentCount = 0;
    for (const qName of KNOWN_QUEUES) {
      const q = new Queue(qName, { connection });
      try {
        const counts = await withTimeout(
          q.getJobCounts('waiting', 'active', 'delayed'),
          4000,
          `BullMQ getJobCounts ${qName}`
        );
        currentCount += (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
      } catch (e) {
        console.error(`Error counting jobs for queue ${qName}:`, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      } finally {
        await safeCloseQueue(q);
      }
    }

    if (currentCount >= maxCapacity) {
      const error = new Error("Our servers are currently under high load. Please try again in a little while.") as Error & { code?: string; statusCode?: number };
      error.code = "SERVER_BUSY";
      error.statusCode = 503;
      throw error;
    }

    // --- Enqueue ---
    const queueName = `${jobType}-queue`;
    const requestQueue = new Queue(queueName, { connection });
    try {
      const addedJob = await withTimeout(
        requestQueue.add(
          `${jobId}-${jobType}-${Date.now()}`,
          { ...jobBody, jobId, jobType },
          {
            priority,
            removeOnComplete: {
              age: 3600,
              count: 100,
            },
            removeOnFail: {
              age: 86400,
              count: 500,
            },
          }
        ),
        8000,
        'BullMQ enqueue'
      );

      console.log(`[+] Enqueued job ${jobId} on ${queueName} with priority ${priority}. Current total queue count: ${currentCount + 1}/${maxCapacity}`);
      return addedJob;
    } finally {
      await safeCloseQueue(requestQueue);
    }
  } finally {
    if (ownsConnection) {
      connection.disconnect();
    }
  }
}

/**
 * Checks total number of jobs currently admitted-but-not-completed across queues.
 * Counts waiting, active, and delayed jobs without loading full job objects.
 *
 * Pass `existingConnection` to reuse an already-connected IORedis client.
 * When omitted, opens and closes its own connection.
 */
export async function getQueueTotalJobs(existingConnection?: IORedis): Promise<number> {
  const ownsConnection = !existingConnection;
  const connection = existingConnection ?? createRedisClient();
  try {
    if (ownsConnection) {
      await withTimeout(connection.connect(), 4000, 'Redis connect');
    }
    let total = 0;
    for (const qName of KNOWN_QUEUES) {
      const q = new Queue(qName, { connection });
      try {
        const counts = await withTimeout(
          q.getJobCounts('waiting', 'active', 'delayed'),
          4000,
          `BullMQ getJobCounts ${qName}`
        );
        total += (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
      } catch (e) {
        console.error(`Error counting jobs for queue ${qName}:`, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      } finally {
        await safeCloseQueue(q);
      }
    }
    return total;
  } finally {
    if (ownsConnection) {
      connection.disconnect();
    }
  }
}

export default enqueue;
