// app/api/test-db/route.ts

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export async function GET() {
    try {
        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL!,
        });

        const prisma = new PrismaClient({ adapter });

        const result = await prisma.$queryRaw`SELECT 1 as ok`;

        return Response.json({
            success: true,
            result,
        });
    } catch (error) {
        console.error("DB TEST ERROR:", error);

        return Response.json(
            {
                success: false,
                error: String(error),
            },
            { status: 500 }
        );
    }
}