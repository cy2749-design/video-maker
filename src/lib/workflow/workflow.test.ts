import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultPromptVersions } from "./prompts";
import { generateStructuredOutput } from "./mock-adapter";
import { generateStructuredOutputWithMimo } from "./mimo-adapter";
import { sceneBlockListSchema, stageSchemas, type WorkflowStage } from "./types";

const originalFetch = globalThis.fetch;
const originalMimoApiKey = process.env.MIMO_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalMimoApiKey === undefined) {
    delete process.env.MIMO_API_KEY;
  } else {
    process.env.MIMO_API_KEY = originalMimoApiKey;
  }
});

const job = {
  id: "job_test",
  rawIdea:
    "我想做一个视频，讲为什么很多传统企业老板学 AI 的第一步就错了。他们总是先问哪个模型好，但真正重要的是先找出公司里每天重复发生、又消耗人力的事情。",
  language: "zh",
  aspectRatio: "9:16",
  visualStyle: "现实短视频",
  targetDurationSeconds: 45,
} as const;

describe("workflow schemas and mock adapter", () => {
  it("creates active prompt versions for every structured workflow stage", () => {
    const prompts = createDefaultPromptVersions();
    const ids = prompts.map((prompt) => prompt.promptId);
    expect(ids).toContain("content_understanding");
    expect(ids).toContain("video_prompts");
    expect(prompts.every((prompt) => prompt.status === "active")).toBe(true);
  });

  it("generates schema-valid outputs across the workflow", async () => {
    const previous: Record<string, unknown> = {};
    const stages: WorkflowStage[] = [
      "content_understanding",
      "video_plan",
      "script",
      "shot_list",
      "scene_blocks",
      "keyframe_prompts",
      "video_prompts",
    ];

    for (const stage of stages) {
      const output = await generateStructuredOutput(stage, { job, previous }, null);
      expect(() => stageSchemas[stage].parse(output)).not.toThrow();
      previous[stage] = output;
    }
  });

  it("keeps Scene Blocks inside the 5-15 second model window", async () => {
    const previous: Record<string, unknown> = {};
    previous.script = await generateStructuredOutput("script", { job, previous }, null);
    previous.shot_list = await generateStructuredOutput("shot_list", { job, previous }, null);
    const sceneBlocks = sceneBlockListSchema.parse(await generateStructuredOutput("scene_blocks", { job, previous }, null));

    expect(sceneBlocks.scene_blocks.length).toBeGreaterThan(1);
    for (const block of sceneBlocks.scene_blocks) {
      expect(block.duration_seconds).toBeGreaterThanOrEqual(5);
      expect(block.duration_seconds).toBeLessThanOrEqual(15);
      expect(block.shot_ids.length).toBeGreaterThan(0);
    }
  });

  it("renders prompt template variables before calling Mimo", async () => {
    process.env.MIMO_API_KEY = "test-key";
    let requestBody: { messages: Array<{ role: string; content: string }> } | null = null;

    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  raw_input_summary: "老板先追模型，而不是先找重复耗人力流程。",
                  core_message: "先找场景，再选模型。",
                  content_intent: "务实观点表达",
                  target_viewer: "",
                  tone: "务实，有一点反差幽默",
                  key_points: ["先问模型是误区", "重复耗人力流程才是切入点"],
                  creative_risk: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const prompt = createDefaultPromptVersions().find((item) => item.promptId === "content_understanding") ?? null;
    await generateStructuredOutputWithMimo("content_understanding", { job, previous: {} }, prompt);

    const userMessage = requestBody?.messages.find((message) => message.role === "user")?.content ?? "";
    expect(userMessage).toContain(job.rawIdea);
    expect(userMessage).toContain(job.visualStyle);
    expect(userMessage).not.toContain("{{rawIdea}}");
    expect(userMessage).not.toContain("{{settings}}");
  });
});
