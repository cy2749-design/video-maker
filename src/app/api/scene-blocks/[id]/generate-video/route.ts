import { NextResponse } from "next/server";
import { generateBlockVideo } from "@/lib/workflow/service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = await generateBlockVideo(id);
  return NextResponse.json({ asset });
}
