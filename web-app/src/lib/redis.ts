import IORedis, { RedisOptions } from 'ioredis';

let redisConnectionInstance: IORedis | null = null;

const REDIS_CONNECT_TIMEOUT_MS = 4000;
const REDIS_COMMAND_TIMEOUT_MS = 4000;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Creates and returns an IORedis connection.
 *
 * Cloudflare Workers cannot keep hanging TCP sockets. ioredis with
 * maxRetriesPerRequest: null (BullMQ's default) will retry forever and
 * the isolate is cancelled: "Worker hung and would never generate a response".
 */
export function getRedisConnection(): IORedis {
  if (redisConnectionInstance) {
    const status = redisConnectionInstance.status;
    if (status === 'end' || status === 'close') {
      try {
        redisConnectionInstance.disconnect();
      } catch {
        // ignore
      }
      redisConnectionInstance = null;
    } else {
      return redisConnectionInstance;
    }
  }

  const url = process.env.REDIS_URL;
  // Always fail fast. Infinite ioredis retries pin Cloudflare isolates
  // ("Worker hung and would never generate a response"). The Python
  // BullMQ worker is a separate process and does not need this client.
  const options: RedisOptions = {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    keepAlive: 0,
    enableReadyCheck: true,
    retryStrategy: (times) => (times > 1 ? null : 200),
    reconnectOnError: () => false,
  };

  if (url) {
    if (url.startsWith('rediss://')) {
      options.tls = {
        rejectUnauthorized: false,
      };
    }
    redisConnectionInstance = new IORedis(url, options);
  } else {
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

  redisConnectionInstance.on('error', (err) => {
    console.error('Redis client error:', err?.message || err);
  });

  return redisConnectionInstance;
}

export async function ensureRedisConnected(redis: IORedis = getRedisConnection()): Promise<IORedis> {
  if (redis.status === 'ready') {
    return redis;
  }
  if (redis.status === 'wait') {
    await withTimeout(redis.connect(), REDIS_CONNECT_TIMEOUT_MS, 'Redis connect');
  } else if (redis.status === 'connecting' || redis.status === 'reconnecting') {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          redis.off('ready', onReady);
          redis.off('error', onError);
        };
        redis.once('ready', onReady);
        redis.once('error', onError);
      }),
      REDIS_CONNECT_TIMEOUT_MS,
      'Redis connect wait'
    );
  }
  return redis;
}

export async function redisCommand<T>(label: string, fn: (redis: IORedis) => Promise<T>): Promise<T> {
  const redis = getRedisConnection();
  await ensureRedisConnected(redis);
  return withTimeout(fn(redis), REDIS_COMMAND_TIMEOUT_MS, label);
}

export interface GroqStatus {
  status: 'AVAILABLE' | 'TEMPORARILY_RATE_LIMITED' | 'DAILY_QUOTA_EXHAUSTED' | 'UNAVAILABLE';
  resetAt: number | null; // Unix timestamp in ms
  remainingRequests?: number;
  remainingTokens?: number;
  message?: string;
}

export async function getGroqStatus(): Promise<GroqStatus> {
  try {
    const data = await redisCommand('Redis GET groq:status_info', (redis) => redis.get('groq:status_info'));
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.resetAt && Date.now() >= parsed.resetAt) {
        return { status: 'AVAILABLE', resetAt: null };
      }
      return parsed;
    }
  } catch (e) {
    console.error('Error fetching Groq status from Redis:', e);
  }
  return { status: 'AVAILABLE', resetAt: null };
}

export async function setGroqStatus(statusInfo: GroqStatus): Promise<void> {
  try {
    await redisCommand('Redis SET groq:status_info', (redis) =>
      redis.set('groq:status_info', JSON.stringify(statusInfo))
    );
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
  const result = await redisCommand('Redis SETNX job lock', (redis) =>
    redis.set(`user:job_lock:${userId}`, 'locked', 'EX', ttlSeconds, 'NX')
  );
  return result === 'OK';
}

export async function releaseUserJobLock(userId: string): Promise<void> {
  await redisCommand('Redis DEL job lock', (redis) => redis.del(`user:job_lock:${userId}`));
}

export default getRedisConnection;
