import { and, eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/db/client";
import {
  generatedAssets,
  promptVersions,
  sceneBlocks,
  shots,
  videoJobs,
  workflowStageOutputs,
} from "@/db/schema";
import { uid } from "@/lib/utils";
import { createDefaultPromptVersions } from "@/lib/workflow/prompts";
import type {
  GeneratedAsset,
  JobBundle,
  PromptVersion,
  SceneBlockRecord,
  ShotRecord,
  StageOutputRecord,
  VideoJob,
  WorkflowStage,
} from "@/lib/workflow/types";

type MemoryState = {
  jobs: VideoJob[];
  stages: StageOutputRecord[];
  shots: ShotRecord[];
  sceneBlocks: SceneBlockRecord[];
  assets: GeneratedAsset[];
  prompts: PromptVersion[];
};

const memory: MemoryState = {
  jobs: [],
  stages: [],
  shots: [],
  sceneBlocks: [],
  assets: [],
  prompts: createDefaultPromptVersions(),
};

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function fromJob(row: typeof videoJobs.$inferSelect): VideoJob {
  return {
    id: row.id,
    rawIdea: row.rawIdea,
    language: row.language,
    aspectRatio: row.aspectRatio as VideoJob["aspectRatio"],
    targetDurationSeconds: row.targetDurationSeconds,
    visualStyle: row.visualStyle as VideoJob["visualStyle"],
    status: row.status as VideoJob["status"],
    currentStage: row.currentStage as VideoJob["currentStage"],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function fromStage(row: typeof workflowStageOutputs.$inferSelect): StageOutputRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    stage: row.stage as WorkflowStage,
    status: row.status as StageOutputRecord["status"],
    promptVersionId: row.promptVersionId,
    output: row.output,
    error: row.error,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function fromShot(row: typeof shots.$inferSelect): ShotRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    sceneBlockId: row.sceneBlockId,
    sectionId: row.sectionId,
    orderInBlock: row.orderInBlock,
    durationSeconds: row.durationSeconds,
    spokenContentRef: row.spokenContentRef,
    visualDescription: row.visualDescription,
    camera: row.camera,
    motion: row.motion,
    visualRole: row.visualRole,
    compositionNote: row.compositionNote,
  };
}

function fromSceneBlock(row: typeof sceneBlocks.$inferSelect): SceneBlockRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    order: row.order,
    durationSeconds: row.durationSeconds,
    shotIds: row.shotIds as string[],
    blockSummary: row.blockSummary,
    visualContinuity: row.visualContinuity,
    audioIntent: row.audioIntent,
    keyframeStrategy: row.keyframeStrategy,
    keyframeImageUrl: row.keyframeImageUrl,
    videoPrompt: row.videoPrompt,
    videoModel: row.videoModel,
    videoUrl: row.videoUrl,
    status: row.status as SceneBlockRecord["status"],
    updatedAt: iso(row.updatedAt),
  };
}

function fromAsset(row: typeof generatedAssets.$inferSelect): GeneratedAsset {
  return {
    id: row.id,
    jobId: row.jobId,
    sceneBlockId: row.sceneBlockId,
    assetType: row.assetType as GeneratedAsset["assetType"],
    model: row.model,
    url: row.url,
    prompt: row.prompt,
    status: row.status as GeneratedAsset["status"],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: iso(row.createdAt),
  };
}

function fromPrompt(row: typeof promptVersions.$inferSelect): PromptVersion {
  return {
    id: row.id,
    promptId: row.promptId as PromptVersion["promptId"],
    status: row.status as PromptVersion["status"],
    systemInstruction: row.systemInstruction,
    userPromptTemplate: row.userPromptTemplate,
    variables: row.variables as string[],
    outputSchema: row.outputSchema,
    changeNote: row.changeNote,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
  };
}

export async function ensureDefaultPrompts() {
  if (!hasDatabase()) return;
  const db = getDb();
  const existing = await db.select().from(promptVersions);
  if (existing.length > 0) return;

  await db.insert(promptVersions).values(
    createDefaultPromptVersions().map((prompt) => ({
      ...prompt,
      createdAt: new Date(prompt.createdAt),
    })),
  );
}

export async function createJob(job: VideoJob) {
  if (!hasDatabase()) {
    memory.jobs.unshift(job);
    return job;
  }

  await ensureDefaultPrompts();
  await getDb().insert(videoJobs).values({
    id: job.id,
    rawIdea: job.rawIdea,
    language: job.language,
    aspectRatio: job.aspectRatio,
    targetDurationSeconds: job.targetDurationSeconds,
    visualStyle: job.visualStyle,
    status: job.status,
    currentStage: job.currentStage,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
  });
  return job;
}

export async function listJobs() {
  if (!hasDatabase()) return memory.jobs;
  const rows = await getDb().select().from(videoJobs);
  return rows.map(fromJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJobBundle(jobId: string): Promise<JobBundle | null> {
  if (!hasDatabase()) {
    const job = memory.jobs.find((item) => item.id === jobId);
    if (!job) return null;
    return {
      job,
      stages: memory.stages.filter((item) => item.jobId === jobId),
      shots: memory.shots.filter((item) => item.jobId === jobId),
      sceneBlocks: memory.sceneBlocks.filter((item) => item.jobId === jobId).sort((a, b) => a.order - b.order),
      assets: memory.assets.filter((item) => item.jobId === jobId),
      storageMode: "demo-memory",
    };
  }

  await ensureDefaultPrompts();
  const db = getDb();
  const [jobRow] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobId));
  if (!jobRow) return null;

  const [stageRows, shotRows, blockRows, assetRows] = await Promise.all([
    db.select().from(workflowStageOutputs).where(eq(workflowStageOutputs.jobId, jobId)),
    db.select().from(shots).where(eq(shots.jobId, jobId)),
    db.select().from(sceneBlocks).where(eq(sceneBlocks.jobId, jobId)),
    db.select().from(generatedAssets).where(eq(generatedAssets.jobId, jobId)),
  ]);

  return {
    job: fromJob(jobRow),
    stages: stageRows.map(fromStage),
    shots: shotRows.map(fromShot),
    sceneBlocks: blockRows.map(fromSceneBlock).sort((a, b) => a.order - b.order),
    assets: assetRows.map(fromAsset),
    storageMode: "neon",
  };
}

export async function saveStage(record: StageOutputRecord) {
  if (!hasDatabase()) {
    memory.stages = memory.stages.filter((item) => !(item.jobId === record.jobId && item.stage === record.stage));
    memory.stages.push(record);
    return record;
  }

  await getDb()
    .insert(workflowStageOutputs)
    .values({
      ...record,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    })
    .onConflictDoUpdate({
      target: workflowStageOutputs.id,
      set: {
        status: record.status,
        promptVersionId: record.promptVersionId,
        output: record.output,
        error: record.error,
        updatedAt: new Date(record.updatedAt),
      },
    });
  return record;
}

export async function updateJob(job: VideoJob) {
  if (!hasDatabase()) {
    memory.jobs = memory.jobs.map((item) => (item.id === job.id ? job : item));
    return job;
  }

  await getDb()
    .update(videoJobs)
    .set({
      rawIdea: job.rawIdea,
      language: job.language,
      aspectRatio: job.aspectRatio,
      targetDurationSeconds: job.targetDurationSeconds,
      visualStyle: job.visualStyle,
      status: job.status,
      currentStage: job.currentStage,
      updatedAt: new Date(job.updatedAt),
    })
    .where(eq(videoJobs.id, job.id));
  return job;
}

export async function replaceShots(jobId: string, records: ShotRecord[]) {
  if (!hasDatabase()) {
    memory.shots = memory.shots.filter((item) => item.jobId !== jobId).concat(records);
    return records;
  }

  const db = getDb();
  await db.delete(shots).where(eq(shots.jobId, jobId));
  if (records.length > 0) await db.insert(shots).values(records);
  return records;
}

export async function replaceSceneBlocks(jobId: string, records: SceneBlockRecord[]) {
  if (!hasDatabase()) {
    memory.sceneBlocks = memory.sceneBlocks.filter((item) => item.jobId !== jobId).concat(records);
    return records;
  }

  const db = getDb();
  await db.delete(sceneBlocks).where(eq(sceneBlocks.jobId, jobId));
  if (records.length > 0) {
    await db.insert(sceneBlocks).values(
      records.map((record) => ({
        ...record,
        updatedAt: new Date(record.updatedAt),
      })),
    );
  }
  return records;
}

export async function updateSceneBlock(record: SceneBlockRecord) {
  if (!hasDatabase()) {
    memory.sceneBlocks = memory.sceneBlocks.map((item) => (item.id === record.id ? record : item));
    return record;
  }

  await getDb()
    .update(sceneBlocks)
    .set({
      durationSeconds: record.durationSeconds,
      shotIds: record.shotIds,
      blockSummary: record.blockSummary,
      visualContinuity: record.visualContinuity,
      audioIntent: record.audioIntent,
      keyframeStrategy: record.keyframeStrategy,
      keyframeImageUrl: record.keyframeImageUrl,
      videoPrompt: record.videoPrompt,
      videoModel: record.videoModel,
      videoUrl: record.videoUrl,
      status: record.status,
      updatedAt: new Date(record.updatedAt),
    })
    .where(eq(sceneBlocks.id, record.id));
  return record;
}

export async function findSceneBlock(blockId: string) {
  if (!hasDatabase()) return memory.sceneBlocks.find((item) => item.id === blockId) ?? null;
  const [row] = await getDb().select().from(sceneBlocks).where(eq(sceneBlocks.id, blockId));
  return row ? fromSceneBlock(row) : null;
}

export async function saveAsset(asset: GeneratedAsset) {
  if (!hasDatabase()) {
    memory.assets.unshift(asset);
    return asset;
  }

  await getDb().insert(generatedAssets).values({
    ...asset,
    createdAt: new Date(asset.createdAt),
  });
  return asset;
}

export async function listPrompts() {
  if (!hasDatabase()) return memory.prompts;
  await ensureDefaultPrompts();
  const rows = await getDb().select().from(promptVersions);
  return rows.map(fromPrompt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getActivePrompt(promptId: PromptVersion["promptId"]) {
  const prompts = await listPrompts();
  return prompts.find((prompt) => prompt.promptId === promptId && prompt.status === "active") ?? null;
}

export async function savePromptVersion(prompt: PromptVersion) {
  if (!hasDatabase()) {
    memory.prompts = memory.prompts.map((item) =>
      item.promptId === prompt.promptId && prompt.status === "active" ? { ...item, status: "archived" } : item,
    );
    memory.prompts.unshift(prompt);
    return prompt;
  }

  const db = getDb();
  if (prompt.status === "active") {
    await db
      .update(promptVersions)
      .set({ status: "archived" })
      .where(and(eq(promptVersions.promptId, prompt.promptId), eq(promptVersions.status, "active")));
  }
  await db.insert(promptVersions).values({
    ...prompt,
    createdAt: new Date(prompt.createdAt),
  });
  return prompt;
}

export async function createDraftPrompt(base: PromptVersion, values: Partial<PromptVersion>) {
  return savePromptVersion({
    ...base,
    ...values,
    id: values.id ?? uid(`${base.promptId}_v`),
    status: values.status ?? "draft",
  });
}
