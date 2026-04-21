import { NextRequest, NextResponse } from "next/server";
import { enqueue } from "@/lib/queue";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const { name, website, description } = await req.json();

    if (!name || !description) {
      return NextResponse.json(
        { error: "Missing required fields: name or description" },
        { status: 400 }
      );
    }

    const jobId = uuidv4();
    const job = {
      jobId,
      jobType: "company_build",
      jobBody: {
        name,
        website,
        description,
      },
    };

    const addedJob = await enqueue(job);

    return NextResponse.json({
      success: true,
      jobId: addedJob.id,
      message: "Company build job enqueued successfully",
    });
  } catch (error: unknown) {
    console.error("Error enqueuing company build job:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { error: "Failed to enqueue job", details: errorMessage },
      { status: 500 }
    );
  }
}
