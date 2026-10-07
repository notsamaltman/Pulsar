import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

/**
 * Creates a NEW Prisma client + pg Pool. Call once per request inside the handler.
 * Never call at module scope. Always `await pool.end()` in a `finally`.
 */
export function getPrisma() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 8000,
  });

  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  return { prisma, pool };
}
