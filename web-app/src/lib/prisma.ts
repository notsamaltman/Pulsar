import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
  pool: Pool;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!;
  const pool =
    globalForPrisma.pool ||
    new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 5000,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pool = pool;
  }

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma =
  globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
