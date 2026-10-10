import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Hyperdrive-aware Prisma client — one instance per isolate.
//
// Hyperdrive is a Cloudflare binding, NOT a process.env variable. It is
// accessed via getCloudflareContext().env.HYPERDRIVE. When Hyperdrive is
// available its .connectionString routes through Cloudflare's local pooler
// (~1ms latency) instead of going directly to Supabase in ap-northeast-2
// (~180ms latency). Without it we fall back to DATABASE_URL (local dev).
//
// The pool + PrismaClient are cached at module scope so they survive across
// requests within the same Workers isolate. pg handles stale connections
// transparently via its own reconnect logic — we never call pool.end().
// ---------------------------------------------------------------------------

let cachedPool: Pool | null = null;
let cachedPrisma: PrismaClient | null = null;

function getConnectionString(): string {
  try {
    // Dynamically require — avoids a hard import that would throw during
    // Next.js SSG/build phases where the Cloudflare context doesn't exist.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    const cs = ctx?.env?.HYPERDRIVE?.connectionString;
    if (cs) return cs as string;
  } catch {
    // Not running on Workers (local dev / build phase) — fall through.
  }
  return process.env.DATABASE_URL!;
}

function buildPool(): Pool {
  const pool = new Pool({
    connectionString: getConnectionString(),
    // max:1 — Workers isolates are single-threaded; one connection is enough
    // and avoids exhausting Supabase's connection limit across many isolates.
    max: 1,
    connectionTimeoutMillis: 10000,
    // Close idle connections after 20s so dormant isolates don't hold a
    // Supabase/Hyperdrive slot open indefinitely.
    idleTimeoutMillis: 20000,
  });

  pool.on("error", (err) => {
    console.error("[prisma] pg pool error — invalidating cache:", err?.message ?? err);
    cachedPool = null;
    cachedPrisma = null;
  });

  return pool;
}

/**
 * Returns the cached Prisma client for this isolate.
 * On Workers uses Hyperdrive; falls back to DATABASE_URL in dev.
 * Never call pool.end() — the pool is intentionally long-lived.
 */
export function getPrisma(): { prisma: PrismaClient } {
  if (!cachedPool || !cachedPrisma) {
    cachedPool = buildPool();
    cachedPrisma = new PrismaClient({ adapter: new PrismaPg(cachedPool) });
  }
  return { prisma: cachedPrisma };
}
