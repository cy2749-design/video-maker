"use client";

import {
  Braces,
  Clapperboard,
  FileJson,
  Film,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCcw,
  Save,
  Settings2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { aspectRatios, visualStyles, workflowStages, type JobBundle, type PromptVersion, type StageOutputRecord, type WorkflowStage } from "@/lib/workflow/types";
import { getPromptTitle } from "@/lib/workflow/prompts";

type WorkflowForm = {
  rawIdea: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  visualStyle: string;
  language: string;
};

type JobListItem = JobBundle["job"];
type ViewMode = "workflow" | "prompts";

const stageLabels: Record<WorkflowStage, string> = {
  content_understanding: "内容理解",
  video_plan: "视频方案",
  script: "脚本",
  shot_list: "镜头规划",
  scene_blocks: "Scene Blocks",
  keyframe_prompts: "关键帧 Prompt",
  video_prompts: "视频 Prompt",
};

const stageIcons: Record<WorkflowStage, ComponentType<{ className?: string }>> = {
  content_understanding: Sparkles,
  video_plan: Workflow,
  script: FileJson,
  shot_list: Clapperboard,
  scene_blocks: Braces,
  keyframe_prompts: ImageIcon,
  video_prompts: Film,
};

function asJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

export function VideoWorkflowApp() {
  const [view, setView] = useState<ViewMode>("workflow");
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [bundle, setBundle] = useState<JobBundle | null>(null);
  const [activeStage, setActiveStage] = useState<WorkflowStage>("content_understanding");
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    rawIdea:
      "我想做一个视频，讲为什么很多传统企业老板学 AI 的第一步就错了。他们总是先问哪个模型好，但真正重要的是先找出公司里每天重复发生、又消耗人力的事情。视频要务实一点，不要像 AI 培训课。",
    targetDurationSeconds: 45,
    aspectRatio: "9:16",
    visualStyle: "现实短视频",
    language: "zh",
  });

  async function loadJobs() {
    const data = await api<{ jobs: JobListItem[] }>("/api/jobs");
    setJobs(data.jobs);
    if (!bundle && data.jobs[0]) await loadBundle(data.jobs[0].id);
  }

  async function loadBundle(id: string) {
    const next = await api<JobBundle>(`/api/jobs/${id}`);
    setBundle(next);
    const firstPending = workflowStages.find((stage) => !next.stages.some((item) => item.stage === stage && item.status === "success"));
    setActiveStage(firstPending ?? "video_prompts");
  }

  async function loadPrompts() {
    const data = await api<{ prompts: PromptVersion[] }>("/api/prompts");
    setPrompts(data.prompts);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJobs().catch((err) => setError(err.message));
    void loadPrompts().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createJob() {
    setBusy("create-job");
    setError(null);
    try {
      const data = await api<{ job: JobListItem }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify(form),
      });
      await loadJobs();
      await loadBundle(data.job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create job failed");
    } finally {
      setBusy(null);
    }
  }

  async function runStage(stage: WorkflowStage) {
    if (!bundle) return;
    setBusy(stage);
    setError(null);
    try {
      await api(`/api/jobs/${bundle.job.id}/run-stage`, {
        method: "POST",
        body: JSON.stringify({ stage }),
      });
      await loadBundle(bundle.job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run stage failed");
    } finally {
      setBusy(null);
    }
  }

  async function runAll() {
    if (!bundle) return;
    for (const stage of workflowStages) {
      setActiveStage(stage);
      await runStage(stage);
    }
  }

  async function refreshCurrent() {
    if (bundle) await loadBundle(bundle.job.id);
    await loadJobs();
    await loadPrompts();
  }

  return (
    <main className="min-h-dvh bg-[#090b0f] text-slate-100">
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-[#0d1117] p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-teal-400/15 text-teal-200">
              <Film className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Video Maker Workflow</h1>
              <p className="text-xs text-slate-400">Scene Block V1 Console</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className={navButton(view === "workflow")} onClick={() => setView("workflow")}>
              <Workflow className="size-4" /> Workflow
            </button>
            <button className={navButton(view === "prompts")} onClick={() => setView("prompts")}>
              <Settings2 className="size-4" /> Prompts
            </button>
          </div>

          <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Jobs</p>
              <button className="text-xs text-teal-200 hover:text-teal-100" onClick={refreshCurrent}>
                Refresh
              </button>
            </div>
            <div className="space-y-2">
              {jobs.length === 0 ? (
                <p className="text-sm text-slate-500">还没有任务，先从右侧创建一个。</p>
              ) : (
                jobs.map((job) => (
                  <button
                    key={job.id}
                    className={cn(
                      "w-full rounded-md border p-3 text-left transition",
                      bundle?.job.id === job.id
                        ? "border-teal-300/40 bg-teal-300/10"
                        : "border-white/10 bg-black/10 hover:border-white/20",
                    )}
                    onClick={() => loadBundle(job.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{job.rawIdea}</span>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {job.targetDurationSeconds}s · {job.aspectRatio} · {job.visualStyle}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="min-w-0 p-4 sm:p-6">
          {error ? (
            <div className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
          ) : null}
          {view === "workflow" ? (
            <WorkflowView
              form={form}
              setForm={setForm}
              bundle={bundle}
              activeStage={activeStage}
              setActiveStage={setActiveStage}
              busy={busy}
              createJob={createJob}
              runStage={runStage}
              runAll={runAll}
              reload={() => bundle && loadBundle(bundle.job.id)}
            />
          ) : (
            <PromptManagement prompts={prompts} reload={loadPrompts} setError={setError} />
          )}
        </section>
      </div>
    </main>
  );
}

function WorkflowView(props: {
  form: WorkflowForm;
  setForm: React.Dispatch<React.SetStateAction<WorkflowForm>>;
  bundle: JobBundle | null;
  activeStage: WorkflowStage;
  setActiveStage: (stage: WorkflowStage) => void;
  busy: string | null;
  createJob: () => Promise<void>;
  runStage: (stage: WorkflowStage) => Promise<void>;
  runAll: () => Promise<void>;
  reload: () => Promise<void> | null;
}) {
  const { form, setForm, bundle, activeStage, setActiveStage, busy, createJob, runStage, runAll, reload } = props;
  const activeRecord = bundle?.stages.find((stage) => stage.stage === activeStage);
  const completedCount = bundle?.stages.filter((stage) => stage.status === "success").length ?? 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-lg border border-white/10 bg-[#0d1117] p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-300">输入想法</label>
              <textarea
                className="mt-2 min-h-32 w-full resize-y rounded-md border border-white/10 bg-black/30 p-3 text-sm leading-6 outline-none transition focus:border-teal-300/60"
                value={form.rawIdea}
                onChange={(event) => setForm((current) => ({ ...current, rawIdea: event.target.value }))}
              />
            </div>
            <div className="grid min-w-64 grid-cols-2 gap-3">
              <Field label="总时长">
                <input
                  className={inputClass}
                  type="number"
                  min={15}
                  max={90}
                  value={form.targetDurationSeconds}
                  onChange={(event) => setForm((current) => ({ ...current, targetDurationSeconds: Number(event.target.value) }))}
                />
              </Field>
              <Field label="语言">
                <input className={inputClass} value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))} />
              </Field>
              <Field label="比例">
                <select className={inputClass} value={form.aspectRatio} onChange={(event) => setForm((current) => ({ ...current, aspectRatio: event.target.value }))}>
                  {aspectRatios.map((ratio) => (
                    <option key={ratio}>{ratio}</option>
                  ))}
                </select>
              </Field>
              <Field label="视觉风格">
                <select className={inputClass} value={form.visualStyle} onChange={(event) => setForm((current) => ({ ...current, visualStyle: event.target.value }))}>
                  {visualStyles.map((style) => (
                    <option key={style}>{style}</option>
                  ))}
                </select>
              </Field>
              <button className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-md bg-teal-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50" onClick={createJob} disabled={busy === "create-job"}>
                {busy === "create-job" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                创建任务
              </button>
            </div>
          </div>
        </section>

        {bundle ? (
          <>
            <section className="rounded-lg border border-white/10 bg-[#0d1117] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-slate-400">当前任务</p>
                  <h2 className="text-xl font-semibold">{bundle.job.rawIdea.slice(0, 54)}...</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {completedCount}/{workflowStages.length} stages · {bundle.storageMode}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className={secondaryButton} onClick={runAll} disabled={Boolean(busy)}>
                    <Play className="size-4" /> Run All
                  </button>
                  <button className={secondaryButton} onClick={() => void reload()} disabled={Boolean(busy)}>
                    <RefreshCcw className="size-4" /> Reload
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-4 xl:grid-cols-7">
                {workflowStages.map((stage) => {
                  const Icon = stageIcons[stage];
                  const record = bundle.stages.find((item) => item.stage === stage);
                  return (
                    <button
                      key={stage}
                      onClick={() => setActiveStage(stage)}
                      className={cn(
                        "min-h-20 rounded-md border p-3 text-left transition",
                        activeStage === stage ? "border-amber-300/60 bg-amber-300/10" : "border-white/10 bg-black/20 hover:border-white/20",
                      )}
                    >
                      <Icon className="mb-2 size-4 text-amber-200" />
                      <p className="text-sm font-medium">{stageLabels[stage]}</p>
                      <StatusBadge status={record?.status ?? "pending"} />
                    </button>
                  );
                })}
              </div>
            </section>

            <StagePanel bundle={bundle} stage={activeStage} record={activeRecord} busy={busy} runStage={runStage} reload={reload} />
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <Sparkles className="mx-auto size-8 text-teal-200" />
            <h2 className="mt-3 text-lg font-semibold">先创建一个视频任务</h2>
            <p className="mt-2 text-sm text-slate-400">创建后可以逐步生成内容理解、视频方案、脚本、Storyboard、关键帧和视频片段。</p>
          </section>
        )}
      </div>

      <aside className="min-w-0 rounded-lg border border-white/10 bg-[#0d1117] p-4">
        <p className="text-sm font-semibold">结构化输出</p>
        <p className="mt-1 text-xs text-slate-500">{activeRecord?.promptVersionId ?? "No prompt version yet"}</p>
        <pre className="mt-4 max-h-[72vh] overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-5 text-slate-300">
          {asJson(activeRecord?.output ?? { status: "pending", stage: activeStage })}
        </pre>
      </aside>
    </div>
  );
}

function StagePanel(props: {
  bundle: JobBundle;
  stage: WorkflowStage;
  record?: StageOutputRecord;
  busy: string | null;
  runStage: (stage: WorkflowStage) => Promise<void>;
  reload: () => Promise<void> | null;
}) {
  const { bundle, stage, record, busy, runStage, reload } = props;
  const [draft, setDraft] = useState(asJson(record?.output ?? {}));
  const [saveState, setSaveState] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(asJson(record?.output ?? {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.updatedAt, record?.stage]);

  async function saveEdit() {
    setSaveState("saving");
    try {
      await api(`/api/jobs/${bundle.job.id}/stage-output`, {
        method: "PATCH",
        body: JSON.stringify({ stage, output: JSON.parse(draft) }),
      });
      await reload();
      setSaveState("saved");
    } catch (err) {
      setSaveState(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#0d1117] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-slate-400">{getPromptTitle(stage)}</p>
          <h3 className="text-lg font-semibold">{stageLabels[stage]}</h3>
        </div>
        <div className="flex gap-2">
          <button className={secondaryButton} onClick={() => runStage(stage)} disabled={Boolean(busy)}>
            {busy === stage ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            生成/重试
          </button>
          <button className={secondaryButton} onClick={saveEdit}>
            <Save className="size-4" /> 保存编辑
          </button>
        </div>
      </div>
      {record?.status === "error" ? <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{record.error}</div> : null}
      {saveState ? <p className="mt-3 text-xs text-slate-400">{saveState}</p> : null}

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <textarea
          className="min-h-[440px] w-full resize-y rounded-md border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-teal-300/60"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <StageSpecific bundle={bundle} stage={stage} reload={reload} />
      </div>
    </section>
  );
}

function StageSpecific({ bundle, stage, reload }: { bundle: JobBundle; stage: WorkflowStage; reload: () => Promise<void> | null }) {
  if (stage === "shot_list" || stage === "scene_blocks") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold">Storyboard</p>
        {bundle.sceneBlocks.length === 0 ? <p className="text-sm text-slate-500">生成 Scene Blocks 后展示分组。</p> : null}
        {bundle.sceneBlocks.map((block) => (
          <div key={block.id} className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-sm text-amber-200">{block.id}</p>
              <span className="text-xs text-slate-400">{block.durationSeconds}s</span>
            </div>
            <p className="mt-2 text-sm text-slate-300">{block.blockSummary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {block.shotIds.map((id) => (
                <span key={id} className="rounded bg-white/10 px-2 py-1 font-mono text-xs text-slate-300">
                  {id}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (stage === "keyframe_prompts") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold">关键帧生成</p>
        {bundle.sceneBlocks.map((block) => (
          <AssetCard key={block.id} block={block} type="keyframe" reload={reload} />
        ))}
      </div>
    );
  }

  if (stage === "video_prompts") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold">视频片段生成</p>
        {bundle.sceneBlocks.map((block) => (
          <AssetCard key={block.id} block={block} type="video" reload={reload} />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-400">
      当前阶段支持直接编辑 JSON。保存后，下游阶段会使用编辑后的结构化结果。
    </div>
  );
}

function AssetCard({ block, type, reload }: { block: JobBundle["sceneBlocks"][number]; type: "keyframe" | "video"; reload: () => Promise<void> | null }) {
  const [busy, setBusy] = useState(false);
  const url = type === "keyframe" ? block.keyframeImageUrl : block.videoUrl;
  async function generate() {
    setBusy(true);
    await api(`/api/scene-blocks/${block.id}/generate-${type}`, { method: "POST", body: "{}" });
    await reload();
    setBusy(false);
  }
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-teal-200">{block.id}</p>
          <p className="text-xs text-slate-500">{block.durationSeconds}s · {block.videoModel}</p>
        </div>
        <button className={secondaryButton} onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          {url ? "重试" : "生成"}
        </button>
      </div>
      {url ? (
        type === "keyframe" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${block.id} keyframe`} className="mt-3 aspect-[9/16] max-h-80 w-full rounded-md border border-white/10 object-cover" />
        ) : (
          <div className="mt-3 rounded-md border border-teal-300/20 bg-teal-300/10 p-4">
            <Film className="size-6 text-teal-200" />
            <p className="mt-2 text-sm font-medium">Mock video clip ready</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-400">{url}</p>
          </div>
        )
      ) : (
        <p className="mt-3 text-sm text-slate-500">等待生成。</p>
      )}
    </div>
  );
}

function PromptManagement({ prompts, reload, setError }: { prompts: PromptVersion[]; reload: () => Promise<void>; setError: (value: string | null) => void }) {
  const activePrompt = prompts[0];
  const [selectedId, setSelectedId] = useState<string | null>(activePrompt?.id ?? null);
  const selected = useMemo(() => prompts.find((prompt) => prompt.id === selectedId) ?? prompts[0], [prompts, selectedId]);
  const [draft, setDraft] = useState<PromptVersion | null>(selected ?? null);
  const [testResult, setTestResult] = useState<unknown>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(selected ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  async function savePrompt(status: PromptVersion["status"]) {
    if (!draft) return;
    try {
      await api("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ ...draft, status, changeNote: draft.changeNote || "Edited in Prompt Management" }),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt save failed");
    }
  }

  async function testPromptNode() {
    if (!draft) return;
    try {
      const data = await api<{ result: unknown }>(`/api/prompts/${draft.id}/test`, {
        method: "POST",
        body: JSON.stringify({ sample: "老板学 AI 的第一步" }),
      });
      setTestResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt test failed");
    }
  }

  if (!draft) return <p className="text-sm text-slate-400">Prompt nodes are loading.</p>;

  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
      <aside className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Prompt 节点</p>
        <div className="space-y-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              className={cn("w-full rounded-md border p-3 text-left", selected?.id === prompt.id ? "border-teal-300/50 bg-teal-300/10" : "border-white/10 bg-black/20")}
              onClick={() => setSelectedId(prompt.id)}
            >
              <p className="text-sm font-medium">{getPromptTitle(prompt.promptId)}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">{prompt.id}</p>
              <StatusBadge status={prompt.status} />
            </button>
          ))}
        </div>
      </aside>
      <section className="rounded-lg border border-white/10 bg-[#0d1117] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-400">Prompt Editor</p>
            <h2 className="text-lg font-semibold">{getPromptTitle(draft.promptId)}</h2>
          </div>
          <div className="flex gap-2">
            <button className={secondaryButton} onClick={() => savePrompt("draft")}>
              <Save className="size-4" /> Draft
            </button>
            <button className={secondaryButton} onClick={() => savePrompt("active")}>
              <Sparkles className="size-4" /> Publish
            </button>
          </div>
        </div>
        <Field label="System instruction">
          <textarea className="min-h-32 w-full rounded-md border border-white/10 bg-black/30 p-3 text-sm outline-none focus:border-teal-300/60" value={draft.systemInstruction} onChange={(event) => setDraft({ ...draft, systemInstruction: event.target.value })} />
        </Field>
        <Field label="User prompt template">
          <textarea className="min-h-56 w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-xs outline-none focus:border-teal-300/60" value={draft.userPromptTemplate} onChange={(event) => setDraft({ ...draft, userPromptTemplate: event.target.value })} />
        </Field>
        <Field label="Change note">
          <input className={inputClass} value={draft.changeNote} onChange={(event) => setDraft({ ...draft, changeNote: event.target.value })} />
        </Field>
      </section>
      <aside className="rounded-lg border border-white/10 bg-[#0d1117] p-4">
        <p className="text-sm font-semibold">变量与 Schema</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.variables.map((variable) => (
            <span key={variable} className="rounded bg-amber-300/10 px-2 py-1 font-mono text-xs text-amber-100">
              {`{{${variable}}}`}
            </span>
          ))}
        </div>
        <pre className="mt-4 max-h-72 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs text-slate-300">{asJson(draft.outputSchema)}</pre>
        <button className={cn(secondaryButton, "mt-4 w-full justify-center")} onClick={testPromptNode}>
          <Play className="size-4" /> 测试 Prompt
        </button>
        <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs text-slate-300">{asJson(testResult ?? { status: "not tested" })}</pre>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "success" || status === "ready" || status === "active" ? "bg-teal-300/10 text-teal-100" : status === "error" ? "bg-red-300/10 text-red-100" : "bg-slate-300/10 text-slate-300";
  return <span className={cn("mt-2 inline-flex rounded px-2 py-1 text-xs", tone)}>{status}</span>;
}

function navButton(active: boolean) {
  return cn("flex h-10 items-center justify-center gap-2 rounded-md border text-sm transition", active ? "border-teal-300/50 bg-teal-300/10 text-teal-100" : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20");
}

const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-sm outline-none focus:border-teal-300/60";
