"use client";

import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Clapperboard,
  Trash2,
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
import {
  aspectRatios,
  videoLanguageLabels,
  videoLanguages,
  visualStyles,
  workflowStages,
  type JobBundle,
  type PromptVersion,
  type StageOutputRecord,
  type WorkflowStage,
} from "@/lib/workflow/types";
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
const visibleWorkflowStages = workflowStages.filter((stage) => stage !== "content_understanding");
const visibleStageSet = new Set<WorkflowStage>(visibleWorkflowStages);

const initialForm: WorkflowForm = {
  rawIdea:
    "我想做一个视频，讲为什么很多传统企业老板学 AI 的第一步就错了。他们总是先问哪个模型好，但真正重要的是先找出公司里每天重复发生、又消耗人力的事情。视频要务实一点，不要像 AI 培训课。",
  targetDurationSeconds: 45,
  aspectRatio: "9:16",
  visualStyle: "现实短视频",
  language: "zh",
};

const stageLabels: Record<WorkflowStage, string> = {
  content_understanding: "内部理解",
  video_plan: "创意方案",
  script: "脚本",
  shot_list: "镜头规划",
  scene_blocks: "Scene Block 分组",
  keyframe_prompts: "关键帧 Prompt",
  video_prompts: "视频片段 Prompt",
};

const stageDescriptions: Record<WorkflowStage, string> = {
  content_understanding: "内部步骤，不在用户流程中展示。",
  video_plan: "把原始想法扩展成可拍的核心创意、关键画面、角色场景和节奏方案。",
  script: "把视频方案拆成可以给视频模型理解的分段表达。",
  shot_list: "把脚本拆成具体镜头。镜头只用于规划，不直接生成视频。",
  scene_blocks: "把连续镜头合并成 5-15 秒的视频生成单位。",
  keyframe_prompts: "为每个 Scene Block 准备关键帧图片 prompt，并可生成预览图。",
  video_prompts: "把 Scene Block、镜头顺序、参考图和音频要求整理成视频生成 prompt。",
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
  if (!response.ok) {
    const detail = Array.isArray(json.details)
      ? json.details
          .map((item: { path?: unknown[]; message?: string }) => {
            const field = Array.isArray(item.path) ? item.path.join(".") : "";
            return field ? `${field}: ${item.message}` : item.message;
          })
          .filter(Boolean)
          .join("; ")
      : "";
    throw new Error(detail || json.error || "Request failed");
  }
  return json;
}

export function VideoWorkflowApp() {
  const [view, setView] = useState<ViewMode>("workflow");
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [bundle, setBundle] = useState<JobBundle | null>(null);
  const [activeStage, setActiveStage] = useState<WorkflowStage>("video_plan");
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<WorkflowForm>(initialForm);

  async function loadJobs() {
    const data = await api<{ jobs: JobListItem[] }>("/api/jobs");
    setJobs(data.jobs);
  }

  async function loadBundle(id: string, keepStage = false) {
    const next = await api<JobBundle>(`/api/jobs/${id}`);
    setBundle(next);
    if (!keepStage) {
      const firstPending =
        visibleWorkflowStages.find((stage) => !next.stages.some((item) => item.stage === stage && item.status === "success")) ??
        "video_prompts";
      setActiveStage(firstPending);
    }
  }

  async function loadPrompts() {
    const data = await api<{ prompts: PromptVersion[] }>("/api/prompts");
    setPrompts(data.prompts);
  }

  async function deleteCurrentJob(jobId: string) {
    setBusy(`delete-${jobId}`);
    setError(null);
    try {
      await api(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (bundle?.job.id === jobId) setBundle(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete job failed");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJobs().catch((err) => setError(err.message));
    void loadPrompts().catch((err) => setError(err.message));
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
      await loadBundle(bundle.job.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run stage failed");
    } finally {
      setBusy(null);
    }
  }

  async function reloadCurrent() {
    if (bundle) await loadBundle(bundle.job.id, true);
    await loadJobs();
    await loadPrompts();
  }

  return (
    <main className="min-h-dvh bg-[#f7f4ed] text-stone-950">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1480px] flex-col">
        <header className="flex flex-col gap-4 border-b border-stone-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-lg bg-stone-950 text-white">
              <Film className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Video Maker Workflow</h1>
              <p className="text-sm text-stone-500">一步一步生成、确认、再进入下一步</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={topTab(view === "workflow")} onClick={() => setView("workflow")}>
              <Workflow className="size-4" />
              工作流
            </button>
            <button className={topTab(view === "prompts")} onClick={() => setView("prompts")}>
              <Settings2 className="size-4" />
              Prompt 管理
            </button>
          </div>
        </header>

        {error ? (
          <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <section className="grid flex-1 gap-5 px-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <JobContext
              bundle={bundle}
              jobs={jobs}
              loadBundle={loadBundle}
              loadJobs={loadJobs}
              setBundle={setBundle}
              deleteJob={deleteCurrentJob}
              busy={busy}
            />
          </aside>

          {view === "workflow" ? (
            <WorkflowWizard
              form={form}
              setForm={setForm}
              bundle={bundle}
              activeStage={activeStage}
              setActiveStage={setActiveStage}
              busy={busy}
              createJob={createJob}
              runStage={runStage}
              reload={reloadCurrent}
            />
          ) : (
            <PromptManagement prompts={prompts} reload={loadPrompts} setError={setError} />
          )}
        </section>
      </div>
    </main>
  );
}

function JobContext({
  bundle,
  jobs,
  loadBundle,
  loadJobs,
  setBundle,
  deleteJob,
  busy,
}: {
  bundle: JobBundle | null;
  jobs: JobListItem[];
  loadBundle: (id: string) => Promise<void>;
  loadJobs: () => Promise<void>;
  setBundle: (bundle: JobBundle | null) => void;
  deleteJob: (jobId: string) => Promise<void>;
  busy: string | null;
}) {
  return (
    <>
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">当前任务</p>
        {bundle ? (
          <div className="mt-3">
            <p className="line-clamp-4 text-sm leading-6 text-stone-800">{bundle.job.rawIdea}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500">
              <span>{bundle.job.targetDurationSeconds}s</span>
              <span>{bundle.job.aspectRatio}</span>
              <span>{bundle.job.visualStyle}</span>
              <span>{bundle.storageMode}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="h-9 rounded-md border border-stone-200 px-3 text-sm text-stone-700 hover:bg-stone-50" onClick={() => setBundle(null)}>
                新建另一个任务
              </button>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm text-red-700 hover:bg-red-100" onClick={() => deleteJob(bundle.job.id)} disabled={busy === `delete-${bundle.job.id}`}>
                {busy === `delete-${bundle.job.id}` ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                删除
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-stone-500">
            还没有选中的任务。先在主区域输入想法并创建，系统会从第一步开始。
          </p>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">历史任务</p>
          <button className="text-xs text-stone-500 hover:text-stone-900" onClick={loadJobs}>
            刷新
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {jobs.length === 0 ? (
            <p className="text-sm text-stone-500">暂无历史任务。</p>
          ) : (
            jobs.slice(0, 8).map((job) => (
              <div
                key={job.id}
                className={cn(
                  "rounded-md border p-3 transition",
                  bundle?.job.id === job.id ? "border-stone-900 bg-stone-50" : "border-stone-200 bg-white hover:bg-stone-50",
                )}
              >
                <button className="w-full text-left" onClick={() => loadBundle(job.id)}>
                  <p className="line-clamp-2 text-sm font-medium text-stone-800">{job.rawIdea}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
                    <span>{job.targetDurationSeconds}s · {job.aspectRatio}</span>
                    <StatusBadge status={job.status} />
                  </div>
                </button>
                <button
                  className="mt-3 inline-flex h-8 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50"
                  onClick={() => deleteJob(job.id)}
                  disabled={busy === `delete-${job.id}`}
                >
                  {busy === `delete-${job.id}` ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function WorkflowWizard(props: {
  form: WorkflowForm;
  setForm: React.Dispatch<React.SetStateAction<WorkflowForm>>;
  bundle: JobBundle | null;
  activeStage: WorkflowStage;
  setActiveStage: (stage: WorkflowStage) => void;
  busy: string | null;
  createJob: () => Promise<void>;
  runStage: (stage: WorkflowStage) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const { form, setForm, bundle, activeStage, setActiveStage, busy, createJob, runStage, reload } = props;
  const activeRecord = bundle?.stages.find((stage) => stage.stage === activeStage);
  const activeIndex = Math.max(0, visibleWorkflowStages.findIndex((stage) => stage === activeStage));
  const completedCount = bundle?.stages.filter((stage) => visibleStageSet.has(stage.stage) && stage.status === "success").length ?? 0;

  if (!bundle) {
    return <IdeaIntake form={form} setForm={setForm} createJob={createJob} busy={busy === "create-job"} />;
  }

  function goNext() {
    const next = visibleWorkflowStages[Math.min(activeIndex + 1, visibleWorkflowStages.length - 1)];
    setActiveStage(next);
  }

  return (
    <div className="min-w-0 space-y-5">
      <ProgressStepper bundle={bundle} activeStage={activeStage} setActiveStage={setActiveStage} />

      <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm text-stone-500">第 {activeIndex + 1} 步 / {visibleWorkflowStages.length}</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">{stageLabels[activeStage]}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{stageDescriptions[activeStage]}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={secondaryButton} onClick={reload} disabled={Boolean(busy)}>
                <RefreshCcw className="size-4" />
                刷新
              </button>
              <button className={primaryButton} onClick={() => runStage(activeStage)} disabled={Boolean(busy)}>
                {busy === activeStage ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {activeRecord?.status === "success" ? "重新生成本步" : "生成本步结果"}
              </button>
            </div>
          </div>
        </div>

        <StepMainContent
          bundle={bundle}
          stage={activeStage}
          record={activeRecord}
          busy={busy}
          runStage={runStage}
          reload={reload}
        />

        <div className="flex flex-col gap-3 border-t border-stone-200 bg-stone-50 p-5 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-stone-500">
            已完成 {completedCount} / {visibleWorkflowStages.length} 步。确认当前结果后再进入下一步，避免后面的镜头和视频 prompt 建在错误方案上。
          </p>
          <button className={primaryButton} disabled={activeRecord?.status !== "success" || activeIndex === visibleWorkflowStages.length - 1} onClick={goNext}>
            确认并进入下一步
            <ArrowRight className="size-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

function IdeaIntake({
  form,
  setForm,
  createJob,
  busy,
}: {
  form: WorkflowForm;
  setForm: React.Dispatch<React.SetStateAction<WorkflowForm>>;
  createJob: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="p-6">
          <p className="text-sm font-medium text-stone-500">开始一个新视频</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">先输入想法，系统会直接生成可确认的创意方案</h2>
          <textarea
            className="mt-6 min-h-[320px] w-full resize-y rounded-md border border-stone-300 bg-white p-4 text-base leading-7 text-stone-900 outline-none transition focus:border-stone-900 focus:ring-4 focus:ring-stone-100"
            value={form.rawIdea}
            onChange={(event) => setForm((current) => ({ ...current, rawIdea: event.target.value }))}
          />
        </div>
        <div className="border-t border-stone-200 bg-stone-50 p-6 xl:border-l xl:border-t-0">
          <p className="text-sm font-semibold text-stone-800">参数</p>
          <Field label="视频总时长">
            <input
              className={inputClass}
              type="number"
              min={15}
              max={90}
              value={form.targetDurationSeconds}
              onChange={(event) => setForm((current) => ({ ...current, targetDurationSeconds: Number(event.target.value) }))}
            />
          </Field>
          <Field label="视频比例">
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
          <Field label="视频语言">
            <select className={inputClass} value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}>
              {videoLanguages.map((language) => (
                <option key={language} value={language}>
                  {videoLanguageLabels[language]}
                </option>
              ))}
            </select>
          </Field>
          <button className={cn(primaryButton, "mt-6 w-full justify-center")} onClick={createJob} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            创建任务并进入创意方案
          </button>
        </div>
      </div>
    </section>
  );
}

function ProgressStepper({
  bundle,
  activeStage,
  setActiveStage,
}: {
  bundle: JobBundle;
  activeStage: WorkflowStage;
  setActiveStage: (stage: WorkflowStage) => void;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {visibleWorkflowStages.map((stage, index) => {
          const record = bundle.stages.find((item) => item.stage === stage);
          const Icon = stageIcons[stage];
          const isActive = stage === activeStage;
          return (
            <button
              key={stage}
              className={cn(
                "flex min-h-20 items-start gap-3 rounded-md border p-3 text-left transition",
                isActive ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white hover:bg-stone-50",
              )}
              onClick={() => setActiveStage(stage)}
            >
              <div className={cn("grid size-7 shrink-0 place-items-center rounded-full", isActive ? "bg-white text-stone-950" : "bg-stone-100 text-stone-600")}>
                {record?.status === "success" ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs opacity-70">Step {index + 1}</p>
                <p className="mt-1 text-sm font-semibold leading-5">{stageLabels[stage]}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StepMainContent({
  bundle,
  stage,
  record,
  busy,
  runStage,
  reload,
}: {
  bundle: JobBundle;
  stage: WorkflowStage;
  record?: StageOutputRecord;
  busy: string | null;
  runStage: (stage: WorkflowStage) => Promise<void>;
  reload: () => Promise<void>;
}) {
  if (!record || record.status === "pending" || record.status === "running") {
    return (
      <div className="grid min-h-[420px] place-items-center p-8 text-center">
        <div>
          <Sparkles className="mx-auto size-9 text-stone-400" />
          <h3 className="mt-4 text-xl font-semibold">这一页还没有生成结果</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">
            点击“生成本步结果”，系统会调用当前 Prompt 和语言模型，生成可以查看和编辑的结构化结果。
          </p>
          <button className={cn(primaryButton, "mt-5")} onClick={() => runStage(stage)} disabled={Boolean(busy)}>
            {busy === stage ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            生成本步结果
          </button>
        </div>
      </div>
    );
  }

  if (record.status === "error") {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{record.error}</div>
        <button className={cn(primaryButton, "mt-4")} onClick={() => runStage(stage)} disabled={Boolean(busy)}>
          <RefreshCcw className="size-4" />
          重试本步
        </button>
      </div>
    );
  }

  if (stage === "scene_blocks") {
    return <SceneBlockReview bundle={bundle} record={record} reload={reload} />;
  }

  if (stage === "keyframe_prompts") {
    return <AssetGenerationReview bundle={bundle} type="keyframe" reload={reload} />;
  }

  if (stage === "video_prompts") {
    return <AssetGenerationReview bundle={bundle} type="video" reload={reload} />;
  }

  return <StructuredResultEditor bundle={bundle} stage={stage} record={record} reload={reload} />;
}

function StructuredResultEditor({
  bundle,
  stage,
  record,
  reload,
}: {
  bundle: JobBundle;
  stage: WorkflowStage;
  record: StageOutputRecord;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(asJson(record.output));
  const [saveState, setSaveState] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(asJson(record.output));
  }, [record.updatedAt, record.output]);

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
    <div className="p-5">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-900">本步骤结果</p>
          <p className="text-sm text-stone-500">这是 AI 生成的结构化内容。你可以直接修改，保存后再确认进入下一步。</p>
        </div>
        <button className={secondaryButton} onClick={saveEdit}>
          <Save className="size-4" />
          保存编辑
        </button>
      </div>
      {saveState ? <p className="mb-2 text-sm text-stone-500">{saveState}</p> : null}
      <textarea
        className="min-h-[560px] w-full resize-y rounded-md border border-stone-300 bg-stone-50 p-4 font-mono text-sm leading-6 text-stone-900 outline-none focus:border-stone-900 focus:bg-white focus:ring-4 focus:ring-stone-100"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}

function SceneBlockReview({ bundle, record, reload }: { bundle: JobBundle; record: StageOutputRecord; reload: () => Promise<void> }) {
  const [showJson, setShowJson] = useState(false);
  return (
    <div className="p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-900">Scene Block 分组结果</p>
          <p className="text-sm text-stone-500">每个 block 是之后真正送去视频模型生成的单位；shot 只是规划单位。</p>
        </div>
        <button className={secondaryButton} onClick={() => setShowJson((value) => !value)}>
          <FileJson className="size-4" />
          {showJson ? "隐藏 JSON" : "查看 JSON"}
        </button>
      </div>

      <div className="mt-5 grid gap-4">
        {bundle.sceneBlocks.map((block) => (
          <div key={block.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-mono text-sm text-stone-500">{block.id}</p>
                <h3 className="mt-1 text-lg font-semibold">{block.blockSummary}</h3>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-stone-700">{block.durationSeconds}s</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-600">{block.visualContinuity}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {block.shotIds.map((shotId) => (
                <span key={shotId} className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-xs text-stone-600">
                  {shotId}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showJson ? <JsonLarge value={record.output} /> : null}
      <button className={cn(secondaryButton, "mt-4")} onClick={reload}>
        <RefreshCcw className="size-4" />
        刷新分组
      </button>
    </div>
  );
}

function AssetGenerationReview({ bundle, type, reload }: { bundle: JobBundle; type: "keyframe" | "video"; reload: () => Promise<void> }) {
  const title = type === "keyframe" ? "关键帧预览" : "视频片段预览";
  return (
    <div className="p-5">
      <div>
        <p className="text-sm font-semibold text-stone-900">{title}</p>
        <p className="mt-1 text-sm text-stone-500">
          当前版本中图片和视频生成仍是 Mock，但 prompt 已经由语言模型生成并保存在任务里。
        </p>
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {bundle.sceneBlocks.map((block) => (
          <AssetCard key={block.id} block={block} type={type} reload={reload} />
        ))}
      </div>
    </div>
  );
}

function AssetCard({ block, type, reload }: { block: JobBundle["sceneBlocks"][number]; type: "keyframe" | "video"; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const url = type === "keyframe" ? block.keyframeImageUrl : block.videoUrl;
  async function generate() {
    setBusy(true);
    await api(`/api/scene-blocks/${block.id}/generate-${type}`, { method: "POST", body: "{}" });
    await reload();
    setBusy(false);
  }
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-stone-500">{block.id}</p>
          <h3 className="mt-1 font-semibold text-stone-900">{block.blockSummary}</h3>
          <p className="mt-1 text-xs text-stone-500">{block.durationSeconds}s · {block.videoModel}</p>
        </div>
        <button className={secondaryButton} onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          {url ? "重试" : "生成"}
        </button>
      </div>
      {url ? (
        type === "keyframe" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${block.id} keyframe`} className="mt-4 aspect-[9/16] max-h-96 w-full rounded-md border border-stone-200 object-cover" />
        ) : (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <Film className="size-6 text-emerald-700" />
            <p className="mt-2 text-sm font-medium text-emerald-950">Mock video clip ready</p>
            <p className="mt-1 break-all font-mono text-xs text-emerald-800">{url}</p>
          </div>
        )
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-500">等待生成。</p>
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
  }, [selected]);

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

  if (!draft) {
    return <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">Prompt nodes are loading.</div>;
  }

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">Prompt 节点</p>
        <div className="space-y-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              className={cn("w-full rounded-md border p-3 text-left", selected?.id === prompt.id ? "border-stone-950 bg-stone-50" : "border-stone-200 bg-white hover:bg-stone-50")}
              onClick={() => setSelectedId(prompt.id)}
            >
              <p className="text-sm font-medium text-stone-900">{getPromptTitle(prompt.promptId)}</p>
              <p className="mt-1 font-mono text-xs text-stone-500">{prompt.id}</p>
              <StatusBadge status={prompt.status} />
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm text-stone-500">Prompt Management</p>
            <h2 className="text-2xl font-semibold tracking-tight">{getPromptTitle(draft.promptId)}</h2>
          </div>
          <div className="flex gap-2">
            <button className={secondaryButton} onClick={() => savePrompt("draft")}>
              <Save className="size-4" />
              保存 Draft
            </button>
            <button className={primaryButton} onClick={() => savePrompt("active")}>
              <Sparkles className="size-4" />
              发布 Active
            </button>
          </div>
        </div>

        <Field label="System instruction">
          <textarea className={textareaClass} value={draft.systemInstruction} onChange={(event) => setDraft({ ...draft, systemInstruction: event.target.value })} />
        </Field>
        <Field label="User prompt template">
          <textarea className={cn(textareaClass, "min-h-56 font-mono text-sm")} value={draft.userPromptTemplate} onChange={(event) => setDraft({ ...draft, userPromptTemplate: event.target.value })} />
        </Field>
        <Field label="Change note">
          <input className={inputClass} value={draft.changeNote} onChange={(event) => setDraft({ ...draft, changeNote: event.target.value })} />
        </Field>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-stone-900">变量</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.variables.map((variable) => (
                <span key={variable} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-xs text-amber-900">
                  {`{{${variable}}}`}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900">测试区</p>
            <button className={cn(secondaryButton, "mt-3")} onClick={testPromptNode}>
              <Play className="size-4" />
              测试 Prompt
            </button>
          </div>
        </div>

        <JsonLarge value={testResult ?? { status: "not tested" }} />
      </section>
    </div>
  );
}

function JsonLarge({ value }: { value: unknown }) {
  return (
    <pre className="mt-5 max-h-[520px] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-4 font-mono text-sm leading-6 text-stone-800">
      {asJson(value)}
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "success" || status === "ready" || status === "active"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "error"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-stone-200 bg-stone-50 text-stone-500";
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs", tone)}>{status}</span>;
}

function topTab(active: boolean) {
  return cn(
    "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition",
    active ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
  );
}

const primaryButton =
  "inline-flex h-10 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40";
const inputClass =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-stone-900 focus:ring-4 focus:ring-stone-100";
const textareaClass =
  "min-h-36 w-full resize-y rounded-md border border-stone-300 bg-white p-3 text-sm leading-6 text-stone-900 outline-none focus:border-stone-900 focus:ring-4 focus:ring-stone-100";
