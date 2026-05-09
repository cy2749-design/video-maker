import { NextResponse } from "next/server";
import { listPrompts } from "@/lib/store/repository";
import { testPrompt } from "@/lib/workflow/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const prompt = (await listPrompts()).find((item) => item.id === id);
  if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  const sample = await request.json();
  return NextResponse.json({ result: await testPrompt(prompt, sample) });
}
