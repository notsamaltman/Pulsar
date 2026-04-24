import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { name, website, description, summary, userId } = await req.json();

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
    console.error("Error creating company:", error);
    return NextResponse.json(
      { error: "Failed to create company" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(companies);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch companies" },
      { status: 500 }
    );
  }
}
