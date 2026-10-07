// app/api/test-redis/route.ts

import { getRedisConnection } from "@/lib/redis";

export const runtime = "nodejs";

export async function GET() {
  const start = Date.now();

  try {
    const redis = getRedisConnection();

    await redis.ping();

    return Response.json({
      ok: true,
      elapsedMs: Date.now() - start,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        elapsedMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}