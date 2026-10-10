import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Hyperdrive-aware Prisma client
//
// When running on Cloudflare Workers, the HYPERDRIVE binding injects a
// connectionString that routes through Cloudflare's local pooler instead of
// going all the way to Supabase in ap-northeast-2. This drops connection
// latency from ~180ms to <5ms and eliminates per-isolate connection overhead.
//
// Fallback: if HYPERDRIVE is not available (local dev, testdb route, etc.)
// we fall back to DATABASE_URL directly.
//
// The pool is module-level so it survives across requests in the same isolate.
// pg handles dead connections transparently — no manual pool.end() needed.
// ---------------------------------------------------------------------------

let cachedPool: Pool | null = null;
let cachedPrisma: PrismaClient | null = null;

function getConnectionString(): string {
  // Hyperdrive binding is available at runtime on Workers as an env var.
  // open-next exposes Workers bindings via process.env automatically.
  const hyperdrive = (process.env as any).HYPERDRIVE;
  if (hyperdrive?.connectionString) {
    return hyperdrive.connectionString as string;
  }
  return process.env.DATABASE_URL!;
}

function buildPool(): Pool {
  const pool = new Pool({
    connectionString: getConnectionString(),
    max: 1,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[prisma] pg pool error — invalidating cache:', err?.message ?? err);
    cachedPool = null;
    cachedPrisma = null;
  });

  return pool;
}

/**
 * Returns the cached Prisma client for this isolate.
 * Uses Hyperdrive when running on Workers, falls back to DATABASE_URL in dev.
 * No pool.end() needed — the pool is reused across requests.
 */
export function getPrisma(): { prisma: PrismaClient } {
  if (!cachedPool || !cachedPrisma) {
    cachedPool = buildPool();
    cachedPrisma = new PrismaClient({ adapter: new PrismaPg(cachedPool) });
  }
  return { prisma: cachedPrisma };
}
