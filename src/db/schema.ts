import { jsonb, pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const videoJobs = pgTable("video_jobs", {
  id: text("id").primaryKey(),
  rawIdea: text("raw_idea").notNull(),
  language: text("language").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  targetDurationSeconds: integer("target_duration_seconds").notNull(),
  visualStyle: text("visual_style").notNull(),
  status: text("status").notNull(),
  currentStage: text("current_stage").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const workflowStageOutputs = pgTable("workflow_stage_outputs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  promptVersionId: text("prompt_version_id"),
  output: jsonb("output").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const shots = pgTable("shots", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  sceneBlockId: text("scene_block_id"),
  sectionId: text("section_id").notNull(),
  orderInBlock: integer("order_in_block").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  spokenContentRef: text("spoken_content_ref").notNull(),
  visualDescription: text("visual_description").notNull(),
  camera: text("camera").notNull(),
  motion: text("motion").notNull(),
  visualRole: text("visual_role").notNull(),
  compositionNote: text("composition_note").notNull(),
});

export const sceneBlocks = pgTable("scene_blocks", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  order: integer("order").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  shotIds: jsonb("shot_ids").notNull(),
  blockSummary: text("block_summary").notNull(),
  visualContinuity: text("visual_continuity").notNull(),
  audioIntent: text("audio_intent").notNull(),
  keyframeStrategy: text("keyframe_strategy").notNull(),
  keyframeImageUrl: text("keyframe_image_url"),
  videoPrompt: text("video_prompt"),
  videoModel: text("video_model").notNull(),
  videoUrl: text("video_url"),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const generatedAssets = pgTable("generated_assets", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  sceneBlockId: text("scene_block_id").notNull(),
  assetType: text("asset_type").notNull(),
  model: text("model").notNull(),
  url: text("url").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const promptVersions = pgTable("prompt_versions", {
  id: text("id").primaryKey(),
  promptId: text("prompt_id").notNull(),
  status: text("status").notNull(),
  systemInstruction: text("system_instruction").notNull(),
  userPromptTemplate: text("user_prompt_template").notNull(),
  variables: jsonb("variables").notNull(),
  outputSchema: jsonb("output_schema").notNull(),
  changeNote: text("change_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
});
