import { NextResponse } from "next/server";
import { createJob, listJobs } from "@/lib/store/repository";
import { nowIso, uid } from "@/lib/utils";
import { createJobSchema } from "@/lib/workflow/types";
import { ZodError } from "zod";

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

export async function POST(request: Request) {
  let input;
  try {
    input = createJobSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid job input", details: error.issues }, { status: 400 });
    }
    throw error;
  }
  const timestamp = nowIso();
  const job = await createJob({
    ...input,
    id: uid("job"),
    status: "draft",
    currentStage: "idea",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return NextResponse.json({ job }, { status: 201 });
}
