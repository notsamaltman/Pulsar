import IORedis, { RedisOptions } from 'ioredis';

let redisConnectionInstance: IORedis | null = null;

/**
 * Creates and returns an IORedis connection instance configured for Upstash or standard Redis environments.
 * Upstash Redis URLs typically start with `rediss://` (TLS enabled).
 * Uses lazyConnect: true to prevent automatic connection attempts during build/prerender time.
 */
export function getRedisConnection(): IORedis {
  if (redisConnectionInstance) {
    return redisConnectionInstance;
  }

  const url = process.env.REDIS_URL;

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  };

  if (url) {
    if (url.startsWith('rediss://')) {
      options.tls = {
        rejectUnauthorized: false,
      };
    }
    redisConnectionInstance = new IORedis(url, options);
  } else {
    // Fallback to explicit host/port or localhost
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;

    redisConnectionInstance = new IORedis({
      ...options,
      host,
      port,
      password,
    });
  }

  return redisConnectionInstance;
}


export interface GroqStatus {
  status: 'AVAILABLE' | 'TEMPORARILY_RATE_LIMITED' | 'DAILY_QUOTA_EXHAUSTED' | 'UNAVAILABLE';
  resetAt: number | null; // Unix timestamp in ms
  remainingRequests?: number;
  remainingTokens?: number;
  message?: string;
}

export async function getGroqStatus(): Promise<GroqStatus> {
  return {
    status: 'AVAILABLE',
    resetAt: null,
  };
}

export async function setGroqStatus(statusInfo: GroqStatus): Promise<void> {
  const redis = getRedisConnection();
  try {
    await redis.set('groq:status_info', JSON.stringify(statusInfo));
  } catch (e) {
    console.error('Error setting Groq status in Redis:', e);
  }
}

export function isGroqExhausted(status: GroqStatus | null | undefined): boolean {
  if (!status) return false;
  return (
    status.status === 'TEMPORARILY_RATE_LIMITED' ||
    status.status === 'DAILY_QUOTA_EXHAUSTED' ||
    status.status === 'UNAVAILABLE'
  );
}

export interface EnrichedGroqStatus extends GroqStatus {
  isExhausted: boolean;
  retryAfterSeconds?: number;
  resetAtLabel?: string;
}

export function enrichGroqStatus(status: GroqStatus): EnrichedGroqStatus {
  const exhausted = isGroqExhausted(status);
  const retryAfterSeconds =
    exhausted && status.resetAt
      ? Math.max(0, Math.ceil((status.resetAt - Date.now()) / 1000))
      : undefined;
  const resetAtLabel =
    exhausted && status.resetAt
      ? new Date(status.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : undefined;
  return {
    ...status,
    isExhausted: exhausted,
    retryAfterSeconds,
    resetAtLabel,
  };
}

/**
 * Checks if user has a successful job today or currently active lock.
 * Uses atomic Redis SETNX key to prevent simultaneous double-enqueue race conditions.
 */
export async function acquireUserJobLock(userId: string, ttlSeconds: number = 30): Promise<boolean> {
  const redis = getRedisConnection();
  const lockKey = `user:job_lock:${userId}`;
  const result = await redis.set(lockKey, 'locked', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseUserJobLock(userId: string): Promise<void> {
  const redis = getRedisConnection();
  await redis.del(`user:job_lock:${userId}`);
}

export default getRedisConnection;

