import { NextResponse } from "next/server";
import {
  redisCommand,
  getGroqStatus,
  enrichGroqStatus,
} from "@/lib/redis";

const HEARTBEAT_KEY = "service_health:ml_service";
const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds threshold

// In-memory fallback if Redis is unreachable
let inMemoryLastHeartbeat: number | null = null;

export async function GET() {
  let lastHeartbeat: number | null = null;
  let source = "memory";

  try {
    const redisVal = await redisCommand("Redis GET service health", (redis) =>
      redis.get(HEARTBEAT_KEY)
    );
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

  let groqStatus = enrichGroqStatus({ status: "AVAILABLE", resetAt: null });
  try {
    groqStatus = enrichGroqStatus(await getGroqStatus());
  } catch (error) {
    console.error("Failed to query Groq status:", error);
  }

  return NextResponse.json({
    status: mlServiceActive ? "healthy" : "degraded",
    mlServiceActive,
    lastHeartbeat,
    timeSinceLastHeartbeatMs: lastHeartbeat ? now - lastHeartbeat : null,
    groqStatus,
    source,
    timestamp: now,
  });
}

export async function POST() {
  const now = Date.now();
  inMemoryLastHeartbeat = now;

  let redisUpdated = false;
  try {
    await redisCommand("Redis SET service health", (redis) =>
      redis.set(HEARTBEAT_KEY, String(now), "EX", 45)
    );
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
