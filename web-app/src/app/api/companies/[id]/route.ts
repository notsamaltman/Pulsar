import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { prisma } = getPrisma();
  try {
    const { id } = await params;

    const session = await getServerSession(authOptions);
    // @ts-expect-error session.user is slightly typed differently in nextauth
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership before deleting
    const existing = await prisma.company.findFirst({ where: { id, userId } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.company.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting company:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json(
      { error: "Failed to delete company" },
      { status: 500 }
    );
  }
}
