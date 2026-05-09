import { NextResponse } from "next/server";
import { generateBlockKeyframe } from "@/lib/workflow/service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = await generateBlockKeyframe(id);
  return NextResponse.json({ asset });
}
