import { createDefaultPromptVersions } from "../src/lib/workflow/prompts";
import { generateStructuredOutputWithMimo } from "../src/lib/workflow/mimo-adapter";
import { stageSchemas, workflowStages, type WorkflowStage } from "../src/lib/workflow/types";

type AnyObject = Record<string, unknown>;

const targetDurationSeconds = Number(process.env.MIMO_EVAL_DURATION_SECONDS ?? 45);
const job = {
  id: "mimo_prompt_eval",
  rawIdea:
    process.env.MIMO_EVAL_RAW_IDEA ??
    "我想做一个45秒竖屏短视频，讲传统企业老板学 AI 的第一步常常错了：他们先问哪个模型好，但真正重要的是先找出公司里每天重复发生、又消耗人力的事情。风格要务实，有一点反差幽默，不像培训课。",
  language: process.env.MIMO_EVAL_LANGUAGE ?? "zh",
  aspectRatio: process.env.MIMO_EVAL_ASPECT_RATIO ?? "9:16",
  visualStyle: process.env.MIMO_EVAL_VISUAL_STYLE ?? "现实短视频",
  targetDurationSeconds,
};

const prompts = createDefaultPromptVersions();
const previous: Record<string, unknown> = {};
const summaries: AnyObject[] = [];
const issues: string[] = [];

function seconds(items: AnyObject[], key = "duration_seconds") {
  return items.reduce((total, item) => total + (typeof item[key] === "number" ? item[key] : 0), 0);
}

function near(actual: number, expected: number, tolerance: number) {
  return Math.abs(actual - expected) <= tolerance;
}

function hasTiming(prompt: string) {
  return /\b\d+\s*[-–—]\s*\d+\s*s\b/i.test(prompt) || /\b\d+\s*to\s*\d+\s*seconds\b/i.test(prompt);
}

function isObject(value: unknown): value is AnyObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objects(value: unknown) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function valueText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function assertQuality(stage: WorkflowStage, parsed: AnyObject) {
  if (stage === "video_plan") {
    const total = seconds(objects(parsed.narrative_structure));
    if (objects(parsed.concept_variations).length < 2) issues.push("video_plan should provide at least 2 concept variations");
    if (!near(total, job.targetDurationSeconds, 3)) issues.push(`video_plan structure seconds ${total} differ from target ${job.targetDurationSeconds}`);
  }

  if (stage === "script") {
    const total = seconds(objects(parsed.script_sections));
    if (!near(total, job.targetDurationSeconds, 5)) issues.push(`script seconds ${total} differ from target ${job.targetDurationSeconds}`);
  }

  if (stage === "shot_list") {
    const script = isObject(previous.script) ? previous.script : undefined;
    if (objects(parsed.shots).length < objects(script?.script_sections).length) issues.push("shot_list has fewer shots than script sections");
  }

  if (stage === "scene_blocks") {
    const shotList = isObject(previous.shot_list) ? previous.shot_list : undefined;
    const allShotIds = objects(shotList?.shots).map((shot) => valueText(shot.shot_id));
    const covered = objects(parsed.scene_blocks).flatMap((block) =>
      Array.isArray(block.shot_ids) ? block.shot_ids.map(String) : [],
    );
    const missing = allShotIds.filter((id) => !covered.includes(id));
    const duplicateCount = covered.length - new Set(covered).size;
    if (missing.length > 0) issues.push(`scene_blocks missed shots: ${missing.join(", ")}`);
    if (duplicateCount > 0) issues.push(`scene_blocks duplicated ${duplicateCount} shot id(s)`);
    if (!objects(parsed.scene_blocks).every((block) => {
      const duration = block.duration_seconds;
      return typeof duration === "number" && duration >= 5 && duration <= 15;
    })) {
      issues.push("scene_blocks contains duration outside 5-15 seconds");
    }
  }

  if (stage === "keyframe_prompts") {
    const previousBlocks = isObject(previous.scene_blocks) ? previous.scene_blocks : undefined;
    const blocks = objects(previousBlocks?.scene_blocks);
    const keyframes = objects(parsed.keyframes);
    if (keyframes.length !== blocks.length) issues.push("keyframe count does not match scene block count");
    if (keyframes.some((item) => valueText(item.prompt).includes("{{"))) {
      issues.push("keyframe prompt contains unresolved template placeholder");
    }
    if (keyframes.some((item) => valueText(item.prompt).length < 80)) {
      issues.push("keyframe prompt is too thin for image generation");
    }
  }

  if (stage === "video_prompts") {
    const previousBlocks = isObject(previous.scene_blocks) ? previous.scene_blocks : undefined;
    const blocks = objects(previousBlocks?.scene_blocks);
    const videos = objects(parsed.videos);
    if (videos.length !== blocks.length) issues.push("video prompt count does not match scene block count");
    if (videos.some((item) => valueText(item.video_prompt).includes("{{"))) {
      issues.push("video prompt contains unresolved template placeholder");
    }
    if (!videos.every((item) => hasTiming(valueText(item.video_prompt)))) {
      issues.push("not every video prompt includes explicit timing beats");
    }
  }
}

async function main() {
  for (const stage of workflowStages) {
    const prompt = prompts.find((item) => item.promptId === stage) ?? null;
    const raw = await generateStructuredOutputWithMimo(stage, { job, previous }, prompt);
    const parsed = stageSchemas[stage].parse(raw) as AnyObject;
    previous[stage] = parsed;
    assertQuality(stage, parsed);

    if (stage === "content_understanding") {
      summaries.push({ stage, core_message: parsed.core_message, key_points: Array.isArray(parsed.key_points) ? parsed.key_points.length : 0 });
    } else if (stage === "video_plan") {
      summaries.push({
        stage,
        title: parsed.video_title,
        variations: objects(parsed.concept_variations).length,
        structure_seconds: seconds(objects(parsed.narrative_structure)),
        key_moments: Array.isArray(parsed.key_visual_moments) ? parsed.key_visual_moments.length : 0,
      });
    } else if (stage === "script") {
      const sections = objects(parsed.script_sections);
      summaries.push({
        stage,
        sections: sections.length,
        section_seconds: seconds(sections),
        first_line: valueText(sections[0]?.spoken_content),
      });
    } else if (stage === "shot_list") {
      const shots = objects(parsed.shots);
      summaries.push({
        stage,
        shots: shots.length,
        first_shot: valueText(shots[0]?.visual_description),
      });
    } else if (stage === "scene_blocks") {
      const blocks = objects(parsed.scene_blocks);
      summaries.push({
        stage,
        blocks: blocks.length,
        block_seconds: seconds(blocks),
        durations_ok: blocks.every((block) => {
          const duration = block.duration_seconds;
          return typeof duration === "number" && duration >= 5 && duration <= 15;
        }),
      });
    } else if (stage === "keyframe_prompts") {
      const keyframes = objects(parsed.keyframes);
      summaries.push({
        stage,
        keyframes: keyframes.length,
        first_prompt: valueText(keyframes[0]?.prompt).slice(0, 260),
      });
    } else if (stage === "video_prompts") {
      const videos = objects(parsed.videos);
      summaries.push({
        stage,
        videos: videos.length,
        first_prompt: valueText(videos[0]?.video_prompt).slice(0, 420),
        all_have_timing: videos.every((item) => hasTiming(valueText(item.video_prompt))),
      });
    }
  }

  console.log(JSON.stringify({ ok: issues.length === 0, issues, summaries }, null, 2));
  if (issues.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
