import type { PromptVersion, WorkflowStage } from "./types";

const defaultBaseUrl = "https://token-plan-sgp.xiaomimimo.com/v1";
const defaultModel = "mimo-v2.5-pro";

type MimoMessage = {
  role: "system" | "user";
  content: string;
};

type MimoResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type MimoWorkflowInput = {
  job?: {
    rawIdea?: string;
    language?: string;
    targetDurationSeconds?: number;
    aspectRatio?: string;
    visualStyle?: string;
  };
  previous?: Record<string, unknown>;
};

export function hasMimoConfig() {
  return Boolean(process.env.MIMO_API_KEY?.trim());
}

export async function generateStructuredOutputWithMimo(
  stage: WorkflowStage,
  input: unknown,
  promptVersion: PromptVersion | null,
) {
  const apiKey = process.env.MIMO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("MIMO_API_KEY is not configured");
  }

  const baseUrl = process.env.MIMO_BASE_URL ?? defaultBaseUrl;
  const model = normalizeMimoModel(process.env.MIMO_MODEL ?? defaultModel);
  const renderedUserPrompt = renderPromptTemplate(
    promptVersion?.userPromptTemplate ?? `Run workflow stage: ${stage}`,
    buildTemplateVariables(input),
  );
  const messages: MimoMessage[] = [
    {
      role: "system",
      content: [
        promptVersion?.systemInstruction ?? "Generate structured JSON for an automated video workflow.",
        "Return only valid JSON. Do not wrap it in markdown. Do not include commentary. Do not include keys outside the requested schema.",
        "The output is for AI image/video generation only. Do not propose live-action filming, real footage collection, creator collaboration, actors, shooting logistics, or editing existing material.",
        stageContract(stage),
      ].join("\n\n"),
    },
    {
      role: "user",
      content: [
        renderedUserPrompt,
        "Complete runtime input JSON for consistency checking:",
        JSON.stringify(input, null, 2),
      ].join("\n\n"),
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as MimoResponse & { error?: unknown };
    if (!response.ok) {
      throw new Error(`Mimo API failed: ${response.status} ${JSON.stringify(payload.error ?? payload)}`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Mimo API returned an empty completion");
    }

    return JSON.parse(extractJsonObject(stripJsonFence(content)));
  } finally {
    clearTimeout(timeout);
  }
}

function renderPromptTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
    formatTemplateValue(Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : ""),
  );
}

function buildTemplateVariables(input: unknown): Record<string, unknown> {
  const workflowInput = isRecord(input) ? (input as MimoWorkflowInput) : {};
  const job = isRecord(workflowInput.job) ? workflowInput.job : {};
  const previous = isRecord(workflowInput.previous) ? workflowInput.previous : {};

  return {
    rawIdea: typeof job.rawIdea === "string" ? job.rawIdea : "",
    settings: {
      language: job.language ?? "auto",
      targetDurationSeconds: job.targetDurationSeconds ?? "",
      aspectRatio: job.aspectRatio ?? "",
      visualStyle: job.visualStyle ?? "",
    },
    contentUnderstanding: previous.content_understanding ?? {},
    videoPlan: previous.video_plan ?? {},
    script: previous.script ?? {},
    shots: previous.shot_list ?? {},
    duration: job.targetDurationSeconds ?? "",
    sceneBlocks: previous.scene_blocks ?? {},
    visualStyle: job.visualStyle ?? "",
    aspectRatio: job.aspectRatio ?? "",
    referenceImages: buildReferenceImages(previous.keyframe_prompts),
  };
}

function buildReferenceImages(keyframeOutput: unknown) {
  if (!isRecord(keyframeOutput) || !Array.isArray(keyframeOutput.keyframes)) return [];
  return keyframeOutput.keyframes.map((keyframe) => {
    const item = isRecord(keyframe) ? keyframe : {};
    return {
      scene_block_id: item.scene_block_id ?? "",
      type: item.keyframe_strategy ?? "first_frame",
      url: item.image_url ?? "",
      prompt: item.prompt ?? "",
    };
  });
}

function formatTemplateValue(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripJsonFence(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function normalizeMimoModel(model: string) {
  const cleanModel = model.trim();
  if (cleanModel === "mimo-2.5-pro") return "mimo-v2.5-pro";
  if (cleanModel === "mimo-2.5") return "mimo-v2.5";
  return cleanModel;
}

function stageContract(stage: WorkflowStage) {
  const contracts: Record<WorkflowStage, string> = {
    content_understanding:
      'Output keys: raw_input_summary string, core_message string, content_intent string, target_viewer string, tone string, key_points string[], creative_risk string[].',
    video_plan:
      'Output keys: video_title string, target_duration_seconds number, aspect_ratio string, visual_style string, decision_status "needs_user_selection", core_idea string, creative_expansion empty array, concept_variations array of {name, description, why_it_works}, selected_concept empty string, key_visual_moments empty array, character_and_setting empty string, narrative_structure empty array, visual_direction empty string, audio_direction empty string, generation_notes empty array. Options must be AI-generated video concepts only, not live-action or editing plans.',
    script:
      'Output keys: title string, target_duration_seconds number, script_sections array of {section_id, section_type, duration_seconds, narration_intent, spoken_content, visual_intent}. visual_intent must describe generated visuals, not filming instructions.',
    shot_list:
      'Output keys: shots array of {shot_id, section_id, duration_seconds, spoken_content_ref, visual_description, camera, motion, visual_role, composition_note}. Shots are virtual AI video shots; do not mention real filming or existing footage.',
    scene_blocks:
      'Output keys: scene_blocks array of {scene_block_id, duration_seconds between 5 and 15, shot_ids string[], block_summary, visual_continuity, audio_intent, keyframe_strategy, generation_model}.',
    keyframe_prompts:
      'Output keys: keyframes array of {scene_block_id, keyframe_strategy, image_model, image_size, prompt, optional image_url}. Use image_model "gpt-image-2".',
    video_prompts:
      'Output keys: videos array of {scene_block_id, video_model, duration_seconds, aspect_ratio, reference_images array of {type,url}, video_prompt, optional video_url, status}. Use video_model "seedance2" unless input asks otherwise.',
  };

  return contracts[stage];
}
