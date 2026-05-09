import { NextResponse } from "next/server";
import { runWorkflowStage } from "@/lib/workflow/service";
import { workflowStages } from "@/lib/workflow/types";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  const stage = body.stage;
  if (!workflowStages.includes(stage)) {
    return NextResponse.json({ error: "Invalid workflow stage" }, { status: 400 });
  }

  const record = await runWorkflowStage(id, stage);
  return NextResponse.json({ stage: record });
}
