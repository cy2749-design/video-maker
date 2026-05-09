import { NextResponse } from "next/server";
import { createDraftPrompt, getActivePrompt, listPrompts, savePromptVersion } from "@/lib/store/repository";
import { nowIso, uid } from "@/lib/utils";
import type { PromptVersion } from "@/lib/workflow/types";

export async function GET() {
  return NextResponse.json({ prompts: await listPrompts() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<PromptVersion> & { promptId: PromptVersion["promptId"] };
  const active = await getActivePrompt(body.promptId);
  if (!active) return NextResponse.json({ error: "Prompt node not found" }, { status: 404 });
  const prompt = await createDraftPrompt(active, {
    ...body,
    id: uid(`${body.promptId}_v`),
    status: body.status ?? "draft",
    createdAt: nowIso(),
    createdBy: body.createdBy ?? "local-user",
  });
  return NextResponse.json({ prompt }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as PromptVersion;
  if (!body.id || !body.promptId) return NextResponse.json({ error: "Invalid prompt payload" }, { status: 400 });
  const prompt = await savePromptVersion({ ...body, createdAt: body.createdAt ?? nowIso() });
  return NextResponse.json({ prompt });
}
