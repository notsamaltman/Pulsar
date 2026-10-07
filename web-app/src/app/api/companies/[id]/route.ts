import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { prisma, pool } = getPrisma();
  try {
    const { id } = await params;

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
  } finally {
    await pool.end();
  }
}
