import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// ---------------------------------------------------------------------------
// Per-request Prisma client with Hyperdrive support.
//
// OpenNext explicitly recommends creating a new client per request on Workers:
// https://opennext.js.org/cloudflare/howtos/db
//
// Reason: pg connection pools reuse TCP connections across requests, but on
// Workers each request is isolated — reusing a pooled connection from a prior
// request causes "cannot use a pool after calling end()" and similar errors.
//
// Hyperdrive is a Workers binding accessible via getCloudflareContext().env.
// Its connectionString points to Cloudflare's local pooler (<1ms latency)
// rather than Supabase directly (~180ms). Hyperdrive itself maintains the
// persistent connection pool on Cloudflare's infrastructure — so creating a
// fresh pg client per request is cheap (no TCP handshake paid by the Worker).
//
// Fallback: if Hyperdrive binding is unavailable (local dev / build phase)
// we fall back to DATABASE_URL directly.
// ---------------------------------------------------------------------------

function getConnectionString(): string {
  try {
    // getCloudflareContext() is synchronous and available inside request handlers.
    // It throws outside of a request context (SSG, build) — we catch and fall back.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    const cs = ctx?.env?.HYPERDRIVE?.connectionString;
    if (cs) return cs as string;
  } catch {
    // Not running on Workers or outside a request context — fall through.
  }
  return process.env.DATABASE_URL!;
}

/**
 * Creates a fresh Prisma client for the current request.
 * Uses Hyperdrive when running on Workers; falls back to DATABASE_URL in dev.
 *
 * Call once at the top of each request handler. Do NOT cache at module scope.
 */
export function getPrisma(): { prisma: PrismaClient } {
  const adapter = new PrismaPg({ connectionString: getConnectionString() });
  const prisma = new PrismaClient({ adapter });
  return { prisma };
}
