import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const start = Date.now();
  const { prisma } = getPrisma();

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
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
      { status: 500 }
    );
  }
}
