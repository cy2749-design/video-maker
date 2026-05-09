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
}

export async function runWorkflowStage(jobId: string, stage: WorkflowStage) {
  const bundle = await getJobBundle(jobId);
  if (!bundle) throw new Error("Job not found");

  const previous = previousMap(bundle.stages);
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
    const output = stageSchemas[stage].parse(raw);
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
    await updateJob({
      ...bundle.job,
      status: nextIndex >= workflowStages.length ? "ready" : "running",
      currentStage: workflowStages[nextIndex] ?? stage,
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
