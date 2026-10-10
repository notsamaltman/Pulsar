import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Module-level cached pool + client.
//
// Cloudflare Workers isolates can serve multiple requests without re-initialising.
// We cache a single Pool and PrismaClient per isolate so subsequent requests in
// the same isolate pay zero TCP handshake cost to Supabase.
//
// The pool uses idleTimeoutMillis so pg naturally closes idle connections rather
// than keeping them open forever — safe for the Workers model where an isolate
// can be killed at any time.
//
// DO NOT call pool.end() in request handlers. Ending the pool tears down the
// cached connection and forces a new handshake on the very next request.
// ---------------------------------------------------------------------------

let cachedPool: Pool | null = null;
let cachedPrisma: PrismaClient | null = null;

function buildPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 8000,
    // Auto-close idle connections after 10 s so a dormant isolate doesn't hold
    // a Supabase slot open indefinitely.
    idleTimeoutMillis: 10000,
  });

  // If the pool errors out (e.g. network blip), invalidate the cache so the
  // next request creates a fresh one instead of hitting a dead pool.
  pool.on('error', (err) => {
    console.error('[prisma] pg pool error — invalidating cache:', err?.message ?? err);
    cachedPool = null;
    cachedPrisma = null;
  });

  return pool;
}

/**
 * Returns the cached Prisma client for this isolate, creating it on first call.
 * Safe to call at the top of any request handler — no pool.end() needed.
 */
export function getPrisma(): { prisma: PrismaClient } {
  if (!cachedPool || !cachedPrisma) {
    cachedPool = buildPool();
    cachedPrisma = new PrismaClient({ adapter: new PrismaPg(cachedPool) });
  }
  return { prisma: cachedPrisma };
}
