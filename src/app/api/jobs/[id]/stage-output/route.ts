import { NextResponse } from "next/server";
import { saveEditedStage } from "@/lib/workflow/service";
import { workflowStages } from "@/lib/workflow/types";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  if (!workflowStages.includes(body.stage)) {
    return NextResponse.json({ error: "Invalid workflow stage" }, { status: 400 });
  }

  const record = await saveEditedStage(id, body.stage, body.output);
  return NextResponse.json({ stage: record });
}
