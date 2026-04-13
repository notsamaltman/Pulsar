// lib/queue.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { NextApiRequest, NextApiResponse } from 'next';

const connection = new IORedis({ maxRetriesPerRequest: null });

export default async function enqueue(req: NextApiRequest, res: NextApiResponse) {
  const { data } = req.body;
  const requestQueue = new Queue(`${data.jobType}-queue`, { connection });
  const job = await requestQueue.add(`${data.jobId}-${data.jobType}-${Date.now()}`, { input: data });
  res.status(200).json({ jobId: job.id });
}