import { NextResponse } from "next/server";
import {
  getRedisClient,
  redisCommandOn,
  getGroqStatusWith,
  getAllPlatformQuotasWith,
  enrichGroqStatus,
} from "@/lib/redis";

const HEARTBEAT_KEY = "service_health:ml_service";
const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds threshold

// In-memory fallback if Redis is unreachable
let inMemoryLastHeartbeat: number | null = null;

export async function GET() {
  let lastHeartbeat: number | null = null;
  let source = "memory";
  let groqStatus = { status: "AVAILABLE" as const, resetAt: null };
  let platformQuotas = {};

  try {
    // Reuses the cached connection — no TCP handshake on warm requests.
    const redis = await getRedisClient();

    try {
      const redisVal = await redisCommandOn(redis, "Redis GET service health", (r) =>
        r.get(HEARTBEAT_KEY)
      );
      if (redisVal) {
        lastHeartbeat = parseInt(String(redisVal), 10);
        source = "redis";
      }
    } catch (error) {
      console.error(
        "Failed to query Redis for service health:",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      );
    }

    try {
      groqStatus = await getGroqStatusWith(redis) as typeof groqStatus;
    } catch (error) {
      console.error(
        "Failed to query Groq status:",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      );
    }

    try {
      platformQuotas = await getAllPlatformQuotasWith(redis);
    } catch (error) {
      console.error(
        "Failed to query platform quotas:",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      );
    }
  } catch (connectErr) {
    console.error(
      "Redis unavailable for service health GET:",
      connectErr instanceof Error ? `${connectErr.name}: ${connectErr.message}` : String(connectErr)
    );
  }

  if (!lastHeartbeat && inMemoryLastHeartbeat) {
    lastHeartbeat = inMemoryLastHeartbeat;
  }

  const now = Date.now();
  const mlServiceActive = lastHeartbeat !== null && (now - lastHeartbeat) < HEARTBEAT_TIMEOUT_MS;
  const enriched = enrichGroqStatus(groqStatus);

  return NextResponse.json({
    status: mlServiceActive ? "healthy" : "degraded",
    mlServiceActive,
    lastHeartbeat,
    timeSinceLastHeartbeatMs: lastHeartbeat ? now - lastHeartbeat : null,
    groqStatus: enriched,
    platformQuotas,
    source,
    timestamp: now,
  });
}

export async function POST() {
  const now = Date.now();
  inMemoryLastHeartbeat = now;

  let redisUpdated = false;
  try {
    const redis = await getRedisClient();
    await redisCommandOn(redis, "Redis SET service health", (r) =>
      r.set(HEARTBEAT_KEY, String(now), "EX", 45)
    );
    redisUpdated = true;
  } catch (error) {
    console.error(
      "Failed to update Redis service health heartbeat:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
  }

  return NextResponse.json({ status: "ok", receivedAt: now, redisUpdated });
}
