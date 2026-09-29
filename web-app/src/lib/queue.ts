// lib/queue.ts
import { Queue } from 'bullmq';
import { getRedisConnection } from './redis';

const connection = getRedisConnection();

export interface Job {
  jobId: string;
  jobType: string;
  jobBody: Record<string, unknown>;
}

/**
 * Universal enqueue function to add jobs to specific queues based on jobType.
 * @param job The job object containing jobId, jobType, and jobBody.
 * @returns The added BullMQ job.
 */
export async function enqueue(job: Job) {
  const { jobId, jobType, jobBody } = job;
  const requestQueue = new Queue(`${jobType}-queue`, { connection });
  
  // Enqueue the job with a unique name and the body as data
  const addedJob = await requestQueue.add(
    `${jobId}-${jobType}-${Date.now()}`,
    { ...jobBody, jobId, jobType }
  );
  
  return addedJob;
}

// Keep a default export for backward compatibility if needed, 
// but pointing to the new function.
export default enqueue;