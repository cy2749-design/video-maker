import {
  findSceneBlock,
  getActivePrompt,
  getJobBundle,
  replaceSceneBlocks,
  replaceShots,
  saveAsset,
  saveStage,
  updateJob,
  updateSceneBlock,
} from "@/lib/store/repository";
import { nowIso } from "@/lib/utils";
import {
  generateKeyframe,
  generateSceneBlockVideo,
  generateStructuredOutput as generateMockStructuredOutput,
} from "./mock-adapter";
import { generateStructuredOutputWithMimo, hasMimoConfig } from "./mimo-adapter";
import {
  stageSchemas,
  workflowStages,
  type GeneratedAsset,
  type KeyframePromptListOutput,
  type PromptVersion,
  type SceneBlockListOutput,
  type SceneBlockRecord,
  type ShotListOutput,
  type ShotRecord,
  type StageOutputRecord,
  type VideoPlan,
  type VideoPromptListOutput,
  type WorkflowStage,
} from "./types";

function previousMap(stages: StageOutputRecord[]) {
  return Object.fromEntries(stages.filter((stage) => stage.status === "success").map((stage) => [stage.stage, stage.output]));
}

function assertStageInput(stage: WorkflowStage, previous: Record<string, unknown>) {
  const index = workflowStages.indexOf(stage);
  const missing = workflowStages.slice(0, index).filter((name) => !previous[name]);
  if (missing.length > 0) {
    throw new Error(`Missing previous stage output: ${missing.join(", ")}`);
  }
  if (index > workflowStages.indexOf("video_plan") && !isApprovedVideoPlan(previous.video_plan)) {
    throw new Error("Creative plan needs a user-selected concept before downstream stages can run.");
  }
}

function isApprovedVideoPlan(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<VideoPlan>;
  return plan.decision_status === "approved" && typeof plan.selected_concept === "string" && plan.selected_concept.trim().length > 0;
}

export async function runWorkflowStage(jobId: string, stage: WorkflowStage) {
  let bundle = await getJobBundle(jobId);
  if (!bundle) throw new Error("Job not found");

  let previous = previousMap(bundle.stages);
  if (stage === "video_plan" && !previous.content_understanding) {
    await runWorkflowStage(jobId, "content_understanding");
    bundle = await getJobBundle(jobId);
    if (!bundle) throw new Error("Job not found");
    previous = previousMap(bundle.stages);
  }
  assertStageInput(stage, previous);

  const prompt = await getActivePrompt(stage);
  const runningAt = nowIso();
  await saveStage({
    id: `${jobId}_${stage}`,
    jobId,
    stage,
    status: "running",
    promptVersionId: prompt?.id ?? null,
    output: {},
    createdAt: runningAt,
    updatedAt: runningAt,
  });

  try {
    const adapterInput = { job: bundle.job, previous };
    const raw = hasMimoConfig()
      ? await generateStructuredOutputWithMimo(stage, adapterInput, prompt)
      : await generateMockStructuredOutput(stage, adapterInput, prompt);
    const output = stageSchemas[stage].parse(normalizeStageOutput(stage, raw, bundle.job, previous));
    const saved = await saveStage({
      id: `${jobId}_${stage}`,
      jobId,
      stage,
      status: "success",
      promptVersionId: prompt?.id ?? null,
      output,
      createdAt: runningAt,
      updatedAt: nowIso(),
    });

    if (stage === "shot_list") {
      await replaceShots(jobId, toShotRecords(jobId, output as ShotListOutput));
    }

    if (stage === "scene_blocks") {
      await replaceSceneBlocks(jobId, toSceneBlockRecords(jobId, output as SceneBlockListOutput));
      const latest = await getJobBundle(jobId);
      if (latest) {
        await replaceShots(
          jobId,
          latest.shots.map((shot) => ({
            ...shot,
            sceneBlockId:
              (output as SceneBlockListOutput).scene_blocks.find((block) => block.shot_ids.includes(shot.id))
                ?.scene_block_id ?? null,
          })),
        );
      }
    }

    if (stage === "video_prompts") {
      const videos = (output as VideoPromptListOutput).videos;
      const latest = await getJobBundle(jobId);
      if (latest) {
        await Promise.all(
          latest.sceneBlocks.map((block) => {
            const video = videos.find((item) => item.scene_block_id === block.id);
            return video ? updateSceneBlock({ ...block, videoPrompt: video.video_prompt, videoModel: video.video_model }) : block;
          }),
        );
      }
    }

    const nextIndex = workflowStages.indexOf(stage) + 1;
    const awaitingUserSelection = stage === "video_plan" && !isApprovedVideoPlan(output);
    await updateJob({
      ...bundle.job,
      status: awaitingUserSelection ? "draft" : nextIndex >= workflowStages.length ? "ready" : "running",
      currentStage: awaitingUserSelection ? "video_plan" : workflowStages[nextIndex] ?? stage,
      updatedAt: nowIso(),
    });

    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown workflow error";
    const failed = await saveStage({
      id: `${jobId}_${stage}`,
      jobId,
      stage,
      status: "error",
      promptVersionId: prompt?.id ?? null,
      output: {},
      error: message,
      createdAt: runningAt,
      updatedAt: nowIso(),
    });
    await updateJob({ ...bundle.job, status: "error", currentStage: stage, updatedAt: nowIso() });
    return failed;
  }
}

export async function saveEditedStage(jobId: string, stage: WorkflowStage, output: unknown) {
  const bundle = await getJobBundle(jobId);
  if (!bundle) throw new Error("Job not found");
  const parsed = stageSchemas[stage].parse(output);
  const prompt = await getActivePrompt(stage);
  const record = await saveStage({
    id: `${jobId}_${stage}`,
    jobId,
    stage,
    status: "success",
    promptVersionId: prompt?.id ?? null,
    output: parsed,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  if (stage === "shot_list") await replaceShots(jobId, toShotRecords(jobId, parsed as ShotListOutput));
  if (stage === "scene_blocks") await replaceSceneBlocks(jobId, toSceneBlockRecords(jobId, parsed as SceneBlockListOutput));
  if (stage === "video_plan" && isApprovedVideoPlan(parsed)) {
    await updateJob({ ...bundle.job, status: "running", currentStage: "script", updatedAt: nowIso() });
  }
  return record;
}

export async function generateBlockKeyframe(sceneBlockId: string) {
  const block = await findSceneBlock(sceneBlockId);
  if (!block) throw new Error("Scene Block not found");
  const bundle = await getJobBundle(block.jobId);
  if (!bundle) throw new Error("Job not found");

  const keyframeStage = bundle.stages.find((stage) => stage.stage === "keyframe_prompts");
  const keyframes = keyframeStage?.output as KeyframePromptListOutput | undefined;
  const prompt = keyframes?.keyframes.find((item) => item.scene_block_id === block.id)?.prompt ?? block.blockSummary;
  const result = await generateKeyframe(block, prompt);
  const asset: GeneratedAsset = {
    id: result.id,
    jobId: block.jobId,
    sceneBlockId: block.id,
    assetType: "keyframe",
    model: result.model,
    url: result.url,
    prompt: result.prompt,
    status: "success",
    metadata: result.metadata,
    createdAt: nowIso(),
  };
  await saveAsset(asset);
  await updateSceneBlock({ ...block, keyframeImageUrl: result.url, status: "success", updatedAt: nowIso() });
  return asset;
}

export async function generateBlockVideo(sceneBlockId: string) {
  const block = await findSceneBlock(sceneBlockId);
  if (!block) throw new Error("Scene Block not found");
  const referenceImages = [block.keyframeImageUrl ?? `/api/mock/keyframe/${block.id}`];
  const prompt = block.videoPrompt ?? buildFallbackVideoPrompt(block);
  const result = await generateSceneBlockVideo(block, referenceImages, prompt);
  const asset: GeneratedAsset = {
    id: result.id,
    jobId: block.jobId,
    sceneBlockId: block.id,
    assetType: "video",
    model: result.model,
    url: result.url,
    prompt: result.prompt,
    status: "success",
    metadata: result.metadata,
    createdAt: nowIso(),
  };
  await saveAsset(asset);
  await updateSceneBlock({ ...block, videoUrl: result.url, videoPrompt: prompt, status: "success", updatedAt: nowIso() });
  return asset;
}

export async function testPrompt(prompt: PromptVersion, sample: unknown) {
  return {
    prompt_id: prompt.promptId,
    prompt_version_id: prompt.id,
    sample_input: sample,
    mock_output_note: "Prompt test ran against the V1 mock adapter contract. Real model calls can replace this adapter later.",
    variables_detected: prompt.variables,
  };
}

function toShotRecords(jobId: string, output: ShotListOutput): ShotRecord[] {
  return output.shots.map((shot, index) => ({
    id: shot.shot_id,
    jobId,
    sceneBlockId: null,
    sectionId: shot.section_id,
    orderInBlock: index + 1,
    durationSeconds: shot.duration_seconds,
    spokenContentRef: shot.spoken_content_ref,
    visualDescription: shot.visual_description,
    camera: shot.camera,
    motion: shot.motion,
    visualRole: shot.visual_role,
    compositionNote: shot.composition_note,
  }));
}

function toSceneBlockRecords(jobId: string, output: SceneBlockListOutput): SceneBlockRecord[] {
  return output.scene_blocks.map((block, index) => ({
    id: block.scene_block_id,
    jobId,
    order: index + 1,
    durationSeconds: block.duration_seconds,
    shotIds: block.shot_ids,
    blockSummary: block.block_summary,
    visualContinuity: block.visual_continuity,
    audioIntent: block.audio_intent,
    keyframeStrategy: block.keyframe_strategy,
    keyframeImageUrl: null,
    videoPrompt: null,
    videoModel: block.generation_model,
    videoUrl: null,
    status: "pending",
    updatedAt: nowIso(),
  }));
}

function buildFallbackVideoPrompt(block: SceneBlockRecord) {
  return `Create a ${block.durationSeconds}-second connected video clip for ${block.id}. ${block.blockSummary}. Audio: ${block.audioIntent}`;
}

function normalizeStageOutput(
  stage: WorkflowStage,
  raw: unknown,
  job: { targetDurationSeconds: number; aspectRatio: string; visualStyle: string },
  previous: Record<string, unknown>,
) {
  if (!raw || typeof raw !== "object") return raw;
  const output = raw as Record<string, unknown>;

  if (stage === "script" && Array.isArray(output.script_sections)) {
    const sections = output.script_sections;
    return {
      ...output,
      title: typeof output.title === "string" ? output.title : "AI 视频脚本",
      target_duration_seconds:
        typeof output.target_duration_seconds === "number" ? output.target_duration_seconds : job.targetDurationSeconds,
      script_sections: sections.map((section, index) => {
        const item = section as Record<string, unknown>;
        return {
          section_id: stringOr(item.section_id, `s${index + 1}`),
          section_type: stringOr(item.section_type, index === 0 ? "hook" : index === 1 ? "development" : "ending"),
          duration_seconds: numberOr(item.duration_seconds, Math.round(job.targetDurationSeconds / sections.length)),
          narration_intent: stringOr(item.narration_intent, stringOr(item.spoken_content, "表达本段核心观点").slice(0, 80)),
          spoken_content: stringOr(item.spoken_content, "围绕用户观点进行自然中文表达。"),
          visual_intent: stringOr(item.visual_intent, "用真实、清晰的画面支撑本段表达。"),
        };
      }),
    };
  }

  if (stage === "shot_list" && Array.isArray(output.shots)) {
    return {
      shots: output.shots.map((shot, index) => {
        const item = shot as Record<string, unknown>;
        return {
          shot_id: stringOr(item.shot_id, `shot_${String(index + 1).padStart(3, "0")}`),
          section_id: stringOr(item.section_id, "s1"),
          duration_seconds: numberOr(item.duration_seconds, 5),
          spoken_content_ref: stringOr(item.spoken_content_ref, ""),
          visual_description: stringOr(item.visual_description, "真实办公室场景中的连续镜头。"),
          camera: stringOr(item.camera, "中景，轻微手持"),
          motion: stringOr(item.motion, "人物自然动作，镜头轻微移动"),
          visual_role: stringOr(item.visual_role, "承接脚本观点"),
          composition_note: stringOr(item.composition_note, `${job.aspectRatio} 构图，主体保持在安全区。`),
        };
      }),
    };
  }

  if (stage === "scene_blocks" && Array.isArray(output.scene_blocks)) {
    return {
      scene_blocks: output.scene_blocks.map((block, index) => {
        const item = block as Record<string, unknown>;
        const shotIds = Array.isArray(item.shot_ids) ? item.shot_ids.map(String) : [];
        return {
          scene_block_id: stringOr(item.scene_block_id, `block_${String(index + 1).padStart(3, "0")}`),
          duration_seconds: Math.min(Math.max(numberOr(item.duration_seconds, 8), 5), 15),
          shot_ids: shotIds,
          block_summary: stringOr(item.block_summary, `Scene Block ${index + 1}`),
          visual_continuity: stringOr(item.visual_continuity, "保持同一人物、同一场景、同一光线。"),
          audio_intent: stringOr(item.audio_intent, "自然中文旁白和轻微环境音。"),
          keyframe_strategy: stringOr(item.keyframe_strategy, "first_frame_only"),
          generation_model: stringOr(item.generation_model, "seedance2"),
        };
      }),
    };
  }

  if (stage === "keyframe_prompts" && Array.isArray(output.keyframes)) {
    return {
      keyframes: output.keyframes.map((keyframe) => {
        const item = keyframe as Record<string, unknown>;
        return {
          scene_block_id: stringOr(item.scene_block_id, "block_001"),
          keyframe_strategy: stringOr(item.keyframe_strategy, "first_frame_only"),
          image_model: stringOr(item.image_model, "gpt-image-2"),
          image_size: stringOr(item.image_size, job.aspectRatio === "9:16" ? "1080x1920" : "1920x1080"),
          prompt: stringOr(item.prompt, `A ${job.visualStyle} keyframe for a ${job.aspectRatio} video.`),
          image_url: typeof item.image_url === "string" ? item.image_url : undefined,
        };
      }),
    };
  }

  if (stage === "video_prompts" && Array.isArray(output.videos)) {
    return {
      videos: output.videos.map((video) => {
        const item = video as Record<string, unknown>;
        return {
          scene_block_id: stringOr(item.scene_block_id, "block_001"),
          video_model: stringOr(item.video_model, "seedance2"),
          duration_seconds: numberOr(item.duration_seconds, 8),
          aspect_ratio: stringOr(item.aspect_ratio, job.aspectRatio),
          reference_images: Array.isArray(item.reference_images) ? item.reference_images : [],
          video_prompt: stringOr(item.video_prompt, "Create a realistic connected video clip from the Scene Block."),
          video_url: typeof item.video_url === "string" ? item.video_url : undefined,
          status: stringOr(item.status, "pending"),
        };
      }),
    };
  }

  if (stage === "video_plan") {
    return {
      ...output,
      decision_status: "needs_user_selection",
      core_idea: stringOr(output.core_idea, stringOr(output.video_concept, "把用户想法扩展成可拍摄的视频创意。")),
      creative_expansion: Array.isArray(output.creative_expansion)
        ? output.creative_expansion.map(String)
        : ["补充更具体的视觉玩法、情节推进和记忆点。"],
      concept_variations: Array.isArray(output.concept_variations)
        ? output.concept_variations.map((variation, index) => {
            const item = variation as Record<string, unknown>;
            return {
              name: stringOr(item.name, `创意方向 ${index + 1}`),
              description: stringOr(item.description, "一个可执行的视频创意方向。"),
              why_it_works: stringOr(item.why_it_works, "这个方向能让原始想法更可视化。"),
            };
          })
        : [
            {
              name: "主创意方向",
              description: stringOr(output.video_concept, "把用户想法扩展成可拍摄的视频创意。"),
              why_it_works: "它保留原始想法，同时给后续脚本和镜头明确抓手。",
            },
          ],
      selected_concept: "",
      key_visual_moments: Array.isArray(output.key_visual_moments) ? output.key_visual_moments.map(String) : [],
      character_and_setting: stringOr(output.character_and_setting, "根据用户想法设置主要角色、场景和关键道具。"),
      target_duration_seconds:
        typeof output.target_duration_seconds === "number" ? output.target_duration_seconds : job.targetDurationSeconds,
      aspect_ratio: stringOr(output.aspect_ratio, job.aspectRatio),
      visual_style: stringOr(output.visual_style, job.visualStyle),
      generation_notes: Array.isArray(output.generation_notes) ? output.generation_notes.map(String) : [],
    };
  }

  if (stage === "content_understanding") {
    return {
      raw_input_summary: stringOr(output.raw_input_summary, ""),
      core_message: stringOr(output.core_message, ""),
      content_intent: stringOr(output.content_intent, "观点表达"),
      target_viewer: stringOr(output.target_viewer, ""),
      tone: stringOr(output.tone, ""),
      key_points: Array.isArray(output.key_points) ? output.key_points.map(String) : [],
      creative_risk: Array.isArray(output.creative_risk) ? output.creative_risk.map(String) : [],
    };
  }

  void previous;
  return raw;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
