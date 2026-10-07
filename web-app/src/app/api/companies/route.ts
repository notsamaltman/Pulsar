import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function POST(req: NextRequest) {
  const { prisma, pool } = getPrisma();
  try {
    const session = await getServerSession(authOptions);

    // @ts-expect-error session.user is slightly typed differently in nextauth
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, website, description, summary } = await req.json();

    if (!name || !description) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const company = await prisma.company.create({
      data: {
        name,
        website,
        description,
        summary,
        userId,
      },
    });

    return NextResponse.json({
      success: true,
      company,
    });
  } catch (error) {
    console.error("Error creating company:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json(
      { error: "Failed to create company" },
      { status: 500 }
    );
  } finally {
    await pool.end();
  }
}

export async function GET() {
  const { prisma, pool } = getPrisma();
  try {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(companies);
  } catch (error) {
    console.error("Error fetching companies:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json(
      { error: "Failed to fetch companies" },
      { status: 500 }
    );
  } finally {
    await pool.end();
  }
}
