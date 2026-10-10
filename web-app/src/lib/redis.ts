import IORedis, { RedisOptions } from 'ioredis';

const REDIS_CONNECT_TIMEOUT_MS = 4000;
const REDIS_COMMAND_TIMEOUT_MS = 4000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export const errMsg = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// ---------------------------------------------------------------------------
// Base IORedis options
// ---------------------------------------------------------------------------

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
  connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  keepAlive: 0,
  enableReadyCheck: true,
  retryStrategy: () => null,
  reconnectOnError: () => false,
};

// ---------------------------------------------------------------------------
// createRedisClient — a raw, unconnected client the caller owns.
// Use this when you need explicit lifecycle control (e.g. BullMQ Queue objects
// that must own their connection). Always call disconnect() when done.
// ---------------------------------------------------------------------------

/** Creates a NEW unconnected client. Caller MUST call disconnect(). */
export function createRedisClient(): IORedis {
  const url = process.env.REDIS_URL;
  let client: IORedis;

  if (url) {
    const options: RedisOptions = { ...baseOptions };
    if (url.startsWith('rediss://')) options.tls = { rejectUnauthorized: false };
    client = new IORedis(url, options);
  } else {
    client = new IORedis({
      ...baseOptions,
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    });
  }

  client.on('error', (err) => console.error('[redis] client error:', err?.message ?? err));
  return client;
}

// ---------------------------------------------------------------------------
// RequestRedisClient — a connected client scoped to a single request.
//
// The module-level cache approach doesn't work reliably against a self-hosted
// Redis server that closes idle TCP connections — IORedis can report status
// 'ready' while the socket is already dead, causing "Stream isn't writeable"
// errors on the next command.
//
// Instead we open one fresh connection per request, use it for ALL Redis
// operations in that request (quota checks, lock, enqueue, etc.), then
// disconnect in finally. This eliminates the stale-socket problem while still
// keeping the per-request connection count at 1.
//
// Usage:
//   const rrc = new RequestRedisClient();
//   try {
//     const redis = await rrc.get();
//     // use redis ...
//   } finally {
//     await rrc.close();
//   }
// ---------------------------------------------------------------------------

export class RequestRedisClient {
  private client: IORedis | null = null;
  private connectPromise: Promise<void> | null = null;

  /** Returns a connected IORedis instance, connecting on first call. */
  async get(): Promise<IORedis> {
    if (!this.client) {
      this.client = createRedisClient();
    }
    if (!this.connectPromise) {
      this.connectPromise = withTimeout(
        this.client.connect(),
        REDIS_CONNECT_TIMEOUT_MS,
        'Redis connect'
      ).catch((err) => {
        this.client = null;
        this.connectPromise = null;
        throw err;
      });
    }
    await this.connectPromise;
    return this.client!;
  }

  /** Disconnects the client. Safe to call even if get() was never called. */
  async close(): Promise<void> {
    if (this.client) {
      try { this.client.disconnect(); } catch {}
      this.client = null;
      this.connectPromise = null;
    }
  }
}

/**
 * Convenience wrapper: opens a fresh Redis connection, calls fn with it,
 * then always disconnects. Use for routes that need a single scoped client.
 *
 * Example:
 *   const result = await withRedis(async (redis) => {
 *     return getGroqStatusWith(redis);
 *   });
 */
export async function withRedis<T>(fn: (redis: IORedis) => Promise<T>): Promise<T> {
  const rrc = new RequestRedisClient();
  try {
    const redis = await rrc.get();
    return await fn(redis);
  } finally {
    await rrc.close();
  }
}

// ---------------------------------------------------------------------------
// redisCommand / redisCommandOn — low-level helpers
// ---------------------------------------------------------------------------

/**
 * Opens a fresh connection, runs fn, then disconnects.
 * Use only for one-off calls from contexts that don't share a connection.
 */
export async function redisCommand<T>(label: string, fn: (redis: IORedis) => Promise<T>): Promise<T> {
  const redis = createRedisClient();
  try {
    await withTimeout(redis.connect(), REDIS_CONNECT_TIMEOUT_MS, `${label} (connect)`);
    return await withTimeout(fn(redis), REDIS_COMMAND_TIMEOUT_MS, label);
  } finally {
    redis.disconnect();
  }
}

/**
 * Runs fn on an already-connected client (no connect/disconnect overhead).
 * Use this inside request handlers that share a single connection.
 */
export async function redisCommandOn<T>(
  redis: IORedis,
  label: string,
  fn: (redis: IORedis) => Promise<T>
): Promise<T> {
  return withTimeout(fn(redis), REDIS_COMMAND_TIMEOUT_MS, label);
}

// ---------------------------------------------------------------------------
// Groq status
// ---------------------------------------------------------------------------

export interface GroqStatus {
  status: 'AVAILABLE' | 'TEMPORARILY_RATE_LIMITED' | 'DAILY_QUOTA_EXHAUSTED' | 'UNAVAILABLE';
  resetAt: number | null;
  remainingRequests?: number;
  remainingTokens?: number;
  message?: string;
}

function _parseGroqStatus(data: string | null): GroqStatus {
  if (!data) return { status: 'AVAILABLE', resetAt: null };
  const parsed: GroqStatus = JSON.parse(data);
  if (parsed.resetAt && Date.now() >= parsed.resetAt) return { status: 'AVAILABLE', resetAt: null };
  return parsed;
}

export async function getGroqStatus(): Promise<GroqStatus> {
  try {
    const data = await redisCommand('Redis GET groq:status_info', (r) => r.get('groq:status_info'));
    return _parseGroqStatus(data);
  } catch (e) {
    console.error('Error fetching Groq status from Redis:', errMsg(e));
    return { status: 'AVAILABLE', resetAt: null };
  }
}

/** Same as getGroqStatus but reuses an already-connected IORedis client. */
export async function getGroqStatusWith(redis: IORedis): Promise<GroqStatus> {
  try {
    const data = await redisCommandOn(redis, 'Redis GET groq:status_info', (r) => r.get('groq:status_info'));
    return _parseGroqStatus(data);
  } catch (e) {
    console.error('Error fetching Groq status from Redis:', errMsg(e));
    return { status: 'AVAILABLE', resetAt: null };
  }
}

export async function setGroqStatus(statusInfo: GroqStatus): Promise<void> {
  try {
    await redisCommand('Redis SET groq:status_info', (r) =>
      r.set('groq:status_info', JSON.stringify(statusInfo))
    );
  } catch (e) {
    console.error('Error setting Groq status in Redis:', errMsg(e));
  }
}

/** Same as setGroqStatus but reuses an already-connected IORedis client. */
export async function setGroqStatusWith(redis: IORedis, statusInfo: GroqStatus): Promise<void> {
  try {
    await redisCommandOn(redis, 'Redis SET groq:status_info', (r) =>
      r.set('groq:status_info', JSON.stringify(statusInfo))
    );
  } catch (e) {
    console.error('Error setting Groq status in Redis:', errMsg(e));
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
  return { ...status, isExhausted: exhausted, retryAfterSeconds, resetAtLabel };
}

// ---------------------------------------------------------------------------
// User job lock
// ---------------------------------------------------------------------------

/**
 * Atomically acquires a per-user job lock (SETNX).
 * Returns true if the lock was acquired, false if already held.
 */
export async function acquireUserJobLock(userId: string, ttlSeconds = 30): Promise<boolean> {
  const result = await redisCommand('Redis SETNX job lock', (r) =>
    r.set(`user:job_lock:${userId}`, 'locked', 'EX', ttlSeconds, 'NX')
  );
  return result === 'OK';
}

/** Same as acquireUserJobLock but reuses an already-connected IORedis client. */
export async function acquireUserJobLockWith(
  redis: IORedis,
  userId: string,
  ttlSeconds = 30
): Promise<boolean> {
  const result = await redisCommandOn(redis, 'Redis SETNX job lock', (r) =>
    r.set(`user:job_lock:${userId}`, 'locked', 'EX', ttlSeconds, 'NX')
  );
  return result === 'OK';
}

export async function releaseUserJobLock(userId: string): Promise<void> {
  await redisCommand('Redis DEL job lock', (r) => r.del(`user:job_lock:${userId}`));
}

/** Same as releaseUserJobLock but reuses an already-connected IORedis client. */
export async function releaseUserJobLockWith(redis: IORedis, userId: string): Promise<void> {
  await redisCommandOn(redis, 'Redis DEL job lock', (r) => r.del(`user:job_lock:${userId}`));
}

// ---------------------------------------------------------------------------
// Platform API quota state  (youtube, producthunt)
// ---------------------------------------------------------------------------

export type PlatformQuotaStatus =
  | 'AVAILABLE'
  | 'EXHAUSTED'     // daily quota gone, resets tomorrow
  | 'RATE_LIMITED'; // temporary 429, short retry window

export interface PlatformQuota {
  platform: 'youtube' | 'producthunt';
  status: PlatformQuotaStatus;
  resetAt: number | null;
  message?: string;
  available: boolean;
}

function platformQuotaKey(platform: string) {
  return `api_quota:${platform}`;
}

function _parsePlatformQuota(
  platform: 'youtube' | 'producthunt',
  data: string | null
): PlatformQuota {
  const defaultVal: PlatformQuota = { platform, status: 'AVAILABLE', resetAt: null, available: true };
  if (!data) return defaultVal;
  const parsed: PlatformQuota = JSON.parse(data);
  if (parsed.resetAt && Date.now() >= parsed.resetAt) return defaultVal;
  return { ...parsed, available: parsed.status === 'AVAILABLE' };
}

export async function getPlatformQuota(
  platform: 'youtube' | 'producthunt'
): Promise<PlatformQuota> {
  try {
    const data = await redisCommand(`Redis GET ${platformQuotaKey(platform)}`, (r) =>
      r.get(platformQuotaKey(platform))
    );
    return _parsePlatformQuota(platform, data);
  } catch {
    return { platform, status: 'AVAILABLE', resetAt: null, available: true };
  }
}

/** Same as getPlatformQuota but reuses an already-connected IORedis client. */
export async function getPlatformQuotaWith(
  redis: IORedis,
  platform: 'youtube' | 'producthunt'
): Promise<PlatformQuota> {
  try {
    const data = await redisCommandOn(redis, `Redis GET ${platformQuotaKey(platform)}`, (r) =>
      r.get(platformQuotaKey(platform))
    );
    return _parsePlatformQuota(platform, data);
  } catch {
    return { platform, status: 'AVAILABLE', resetAt: null, available: true };
  }
}

export async function getAllPlatformQuotas(): Promise<Record<string, PlatformQuota>> {
  const [youtube, producthunt] = await Promise.all([
    getPlatformQuota('youtube'),
    getPlatformQuota('producthunt'),
  ]);
  return { youtube, producthunt };
}

/** Same as getAllPlatformQuotas but reuses an already-connected IORedis client. */
export async function getAllPlatformQuotasWith(redis: IORedis): Promise<Record<string, PlatformQuota>> {
  const [youtube, producthunt] = await Promise.all([
    getPlatformQuotaWith(redis, 'youtube'),
    getPlatformQuotaWith(redis, 'producthunt'),
  ]);
  return { youtube, producthunt };
}
