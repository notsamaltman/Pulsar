import { NextResponse } from "next/server";
import { getRedisConnection } from "@/lib/redis";

const HEARTBEAT_KEY = "service_health:ml_service";
const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds threshold

// In-memory fallback if Redis is unreachable
let inMemoryLastHeartbeat: number | null = null;

export async function GET() {
  let lastHeartbeat: number | null = null;
  let source = "memory";

  try {
    const redis = getRedisConnection();
    if (redis.status === "wait") {
      await redis.connect();
    }
    const redisVal = await redis.get(HEARTBEAT_KEY);
    if (redisVal) {
      lastHeartbeat = parseInt(String(redisVal), 10);
      source = "redis";
    }
  } catch (error) {
    console.error("Failed to query Redis for service health:", error);
  }

  // Fallback to in-memory if Redis had no value or threw error
  if (!lastHeartbeat && inMemoryLastHeartbeat) {
    lastHeartbeat = inMemoryLastHeartbeat;
  }

  const now = Date.now();
  const mlServiceActive = lastHeartbeat !== null && (now - lastHeartbeat) < HEARTBEAT_TIMEOUT_MS;

  return NextResponse.json({
    status: mlServiceActive ? "healthy" : "degraded",
    mlServiceActive,
    lastHeartbeat,
    timeSinceLastHeartbeatMs: lastHeartbeat ? now - lastHeartbeat : null,
    source,
    timestamp: now,
  });
}

export async function POST() {
  const now = Date.now();
  inMemoryLastHeartbeat = now;

  let redisUpdated = false;
  try {
    const redis = getRedisConnection();
    if (redis.status === "wait") {
      await redis.connect();
    }
    // Set heartbeat timestamp with 45s TTL
    await redis.set(HEARTBEAT_KEY, String(now), "EX", 45);
    redisUpdated = true;
  } catch (error) {
    console.error("Failed to update Redis service health heartbeat:", error);
  }

  return NextResponse.json({
    status: "ok",
    receivedAt: now,
    redisUpdated,
  });
}
