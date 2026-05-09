import { NextResponse } from "next/server";
import { deleteJob, getJobBundle } from "@/lib/store/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const bundle = await getJobBundle(id);
  if (!bundle) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(bundle);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
