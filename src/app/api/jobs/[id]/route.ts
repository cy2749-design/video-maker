import { NextResponse } from "next/server";
import { getJobBundle } from "@/lib/store/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const bundle = await getJobBundle(id);
  if (!bundle) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(bundle);
}
