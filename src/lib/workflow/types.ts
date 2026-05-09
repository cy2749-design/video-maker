import { z } from "zod";

export const visualStyles = ["现实短视频", "纪录片感", "轻剧情感", "干净图文感", "电影感"] as const;
export const aspectRatios = ["9:16", "16:9", "1:1", "4:5"] as const;
export const workflowStages = [
  "content_understanding",
  "video_plan",
  "script",
  "shot_list",
  "scene_blocks",
  "keyframe_prompts",
  "video_prompts",
] as const;

export type WorkflowStage = (typeof workflowStages)[number];
export type StageStatus = "pending" | "running" | "success" | "error";
export type JobStatus = "draft" | "running" | "ready" | "error";

export const createJobSchema = z.object({
  rawIdea: z.string().min(10),
  targetDurationSeconds: z.coerce.number().int().min(15).max(90),
  aspectRatio: z.enum(aspectRatios),
  visualStyle: z.enum(visualStyles),
  language: z.string().min(2).default("auto"),
});

export const contentUnderstandingSchema = z.object({
  raw_input_summary: z.string(),
  core_message: z.string(),
  content_intent: z.string(),
  target_viewer: z.string(),
  tone: z.string(),
  key_points: z.array(z.string()),
  creative_risk: z.array(z.string()),
});

export const videoPlanSchema = z.object({
  video_title: z.string(),
  target_duration_seconds: z.number(),
  aspect_ratio: z.string(),
  visual_style: z.string(),
  video_concept: z.string(),
  narrative_structure: z.array(
    z.object({
      part: z.string(),
      goal: z.string(),
      duration_seconds: z.number(),
    }),
  ),
  visual_direction: z.string(),
  audio_direction: z.string(),
});

export const scriptSchema = z.object({
  title: z.string(),
  target_duration_seconds: z.number(),
  script_sections: z.array(
    z.object({
      section_id: z.string(),
      section_type: z.string(),
      duration_seconds: z.number(),
      narration_intent: z.string(),
      spoken_content: z.string(),
      visual_intent: z.string(),
    }),
  ),
});

export const shotListSchema = z.object({
  shots: z.array(
    z.object({
      shot_id: z.string(),
      section_id: z.string(),
      duration_seconds: z.number(),
      spoken_content_ref: z.string(),
      visual_description: z.string(),
      camera: z.string(),
      motion: z.string(),
      visual_role: z.string(),
      composition_note: z.string(),
    }),
  ),
});

export const sceneBlockListSchema = z.object({
  scene_blocks: z.array(
    z.object({
      scene_block_id: z.string(),
      duration_seconds: z.number().min(5).max(15),
      shot_ids: z.array(z.string()),
      block_summary: z.string(),
      visual_continuity: z.string(),
      audio_intent: z.string(),
      keyframe_strategy: z.string(),
      generation_model: z.string(),
    }),
  ),
});

export const keyframePromptListSchema = z.object({
  keyframes: z.array(
    z.object({
      scene_block_id: z.string(),
      keyframe_strategy: z.string(),
      image_model: z.string(),
      image_size: z.string(),
      prompt: z.string(),
      image_url: z.string().optional(),
    }),
  ),
});

export const videoPromptListSchema = z.object({
  videos: z.array(
    z.object({
      scene_block_id: z.string(),
      video_model: z.string(),
      duration_seconds: z.number(),
      aspect_ratio: z.string(),
      reference_images: z.array(z.object({ type: z.string(), url: z.string() })),
      video_prompt: z.string(),
      video_url: z.string().optional(),
      status: z.string(),
    }),
  ),
});

export const stageSchemas = {
  content_understanding: contentUnderstandingSchema,
  video_plan: videoPlanSchema,
  script: scriptSchema,
  shot_list: shotListSchema,
  scene_blocks: sceneBlockListSchema,
  keyframe_prompts: keyframePromptListSchema,
  video_prompts: videoPromptListSchema,
} satisfies Record<WorkflowStage, z.ZodType>;

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type ContentUnderstanding = z.infer<typeof contentUnderstandingSchema>;
export type VideoPlan = z.infer<typeof videoPlanSchema>;
export type ScriptOutput = z.infer<typeof scriptSchema>;
export type ShotListOutput = z.infer<typeof shotListSchema>;
export type SceneBlockListOutput = z.infer<typeof sceneBlockListSchema>;
export type KeyframePromptListOutput = z.infer<typeof keyframePromptListSchema>;
export type VideoPromptListOutput = z.infer<typeof videoPromptListSchema>;

export type VideoJob = CreateJobInput & {
  id: string;
  status: JobStatus;
  currentStage: WorkflowStage | "idea";
  createdAt: string;
  updatedAt: string;
};

export type StageOutputRecord = {
  id: string;
  jobId: string;
  stage: WorkflowStage;
  status: StageStatus;
  promptVersionId: string | null;
  output: unknown;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShotRecord = {
  id: string;
  jobId: string;
  sceneBlockId: string | null;
  sectionId: string;
  orderInBlock: number;
  durationSeconds: number;
  spokenContentRef: string;
  visualDescription: string;
  camera: string;
  motion: string;
  visualRole: string;
  compositionNote: string;
};

export type SceneBlockRecord = {
  id: string;
  jobId: string;
  order: number;
  durationSeconds: number;
  shotIds: string[];
  blockSummary: string;
  visualContinuity: string;
  audioIntent: string;
  keyframeStrategy: string;
  keyframeImageUrl: string | null;
  videoPrompt: string | null;
  videoModel: string;
  videoUrl: string | null;
  status: StageStatus;
  updatedAt: string;
};

export type GeneratedAsset = {
  id: string;
  jobId: string;
  sceneBlockId: string;
  assetType: "keyframe" | "video";
  model: string;
  url: string;
  prompt: string;
  status: StageStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PromptVersion = {
  id: string;
  promptId: WorkflowStage | "scene_block_video_prompt";
  status: "draft" | "active" | "archived";
  systemInstruction: string;
  userPromptTemplate: string;
  variables: string[];
  outputSchema: unknown;
  changeNote: string;
  createdAt: string;
  createdBy: string;
};

export type JobBundle = {
  job: VideoJob;
  stages: StageOutputRecord[];
  shots: ShotRecord[];
  sceneBlocks: SceneBlockRecord[];
  assets: GeneratedAsset[];
  storageMode: "neon" | "demo-memory";
};
