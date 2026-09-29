import IORedis, { RedisOptions } from 'ioredis';

/**
 * Creates and returns an IORedis connection instance configured for Upstash or standard Redis environments.
 * Upstash Redis URLs typically start with `rediss://` (TLS enabled).
 */
export function getRedisConnection(): IORedis {
  let url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

  // If no direct redis:// or rediss:// URL is set, check if REST credentials can be converted
  if (!url && process.env.UPSTASH_REDIS_REST_URL) {
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
    const host = restUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (token) {
      url = `rediss://default:${token}@${host}:6379`;
    } else {
      url = `rediss://${host}:6379`;
    }
  }

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
  };

  if (url) {
    if (url.startsWith('rediss://') || url.includes('upstash.io')) {
      options.tls = {
        rejectUnauthorized: false,
      };
    }
    return new IORedis(url, options);
  }

  // Fallback to explicit host/port or localhost
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;

  return new IORedis({
    ...options,
    host,
    port,
    password,
  });
}

export default getRedisConnection;
