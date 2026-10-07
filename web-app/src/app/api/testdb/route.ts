import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const start = Date.now();

  try {
    const result = await prisma.user.findFirst({
      select: {
        id: true,
        email: true,
      },
    });

    return Response.json({
      ok: true,
      elapsedMs: Date.now() - start,
      user: result,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        elapsedMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}