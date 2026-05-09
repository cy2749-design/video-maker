import { clamp, uid } from "@/lib/utils";
import type {
  ContentUnderstanding,
  CreateJobInput,
  KeyframePromptListOutput,
  PromptVersion,
  SceneBlockListOutput,
  SceneBlockRecord,
  ScriptOutput,
  ShotListOutput,
  VideoPlan,
  VideoPromptListOutput,
  WorkflowStage,
} from "./types";

type StageContext = {
  job: CreateJobInput & { id: string };
  previous: Record<string, unknown>;
};

function shortIdea(rawIdea: string) {
  return rawIdea.replace(/\s+/g, " ").slice(0, 88);
}

function durationParts(total: number) {
  const hook = clamp(Math.round(total * 0.15), 4, 8);
  const ending = clamp(Math.round(total * 0.22), 5, 12);
  return { hook, development: Math.max(total - hook - ending, 6), ending };
}

export async function generateStructuredOutput(
  stage: WorkflowStage,
  context: StageContext,
  promptVersion: PromptVersion | null,
) {
  void promptVersion;
  const { job, previous } = context;
  const idea = shortIdea(job.rawIdea);

  if (stage === "content_understanding") {
    return {
      raw_input_summary: idea,
      core_message: "企业学习 AI 的第一步不是追模型，而是识别高频、重复、耗人力的业务场景。",
      content_intent: "观点表达",
      target_viewer: "传统企业老板、业务负责人、正在考虑 AI 转型的管理者",
      tone: "务实、克制、有判断力，避免培训课口吻",
      key_points: [
        "很多人先问哪个模型好",
        "真正重要的是先找重复发生且消耗人力的事情",
        "AI 应该从业务流程切入，而不是从工具清单切入",
      ],
      creative_risk: ["画面过于科技感", "表达像 AI 课程广告", "把重点跑偏成模型评测"],
    } satisfies ContentUnderstanding;
  }

  if (stage === "video_plan") {
    const parts = durationParts(job.targetDurationSeconds);
    return {
      video_title: "老板学 AI，第一步常常错了",
      target_duration_seconds: job.targetDurationSeconds,
      aspect_ratio: job.aspectRatio,
      visual_style: job.visualStyle,
      video_concept: "用一个办公室里的真实业务场景，把“追模型”与“找重复劳动”形成对比。",
      narrative_structure: [
        { part: "hook", goal: "指出常见误区：一上来问哪个模型最好。", duration_seconds: parts.hook },
        {
          part: "development",
          goal: "展开真正的切入点：找每天重复、耗人力、能被流程化的事情。",
          duration_seconds: parts.development,
        },
        { part: "ending", goal: "留下判断标准：先找场景，再选模型。", duration_seconds: parts.ending },
      ],
      visual_direction: `${job.visualStyle}，真实办公室、会议桌、白板、电脑和笔记本，画面干净可读。`,
      audio_direction: "自然中文旁白，节奏稳定，语气稍微批判但不夸张，保留轻微办公室环境声。",
    } satisfies VideoPlan;
  }

  if (stage === "script") {
    const plan = previous.video_plan as VideoPlan | undefined;
    const parts = durationParts(job.targetDurationSeconds);
    return {
      title: plan?.video_title ?? "AI 转型的第一步",
      target_duration_seconds: job.targetDurationSeconds,
      script_sections: [
        {
          section_id: "s1",
          section_type: "hook",
          duration_seconds: parts.hook,
          narration_intent: "快速抓住误区。",
          spoken_content: "很多老板学 AI，第一句话就是：到底哪个模型最好？",
          visual_intent: "呈现一个管理者面对一堆 AI 工具页面时的困惑。",
        },
        {
          section_id: "s2",
          section_type: "development",
          duration_seconds: parts.development,
          narration_intent: "把判断标准从模型切到业务流程。",
          spoken_content:
            "但真正该先问的是，公司里哪些事情每天都在重复发生、又一直消耗人力？这些地方，才是 AI 最先应该进去的位置。",
          visual_intent: "展示白板上的流程、客服表格、重复录入、会议记录等具体业务动作。",
        },
        {
          section_id: "s3",
          section_type: "ending",
          duration_seconds: parts.ending,
          narration_intent: "收束成一句可记住的观点。",
          spoken_content: "先找场景，再选模型。否则学得越多，越容易停在工具表面。",
          visual_intent: "管理者把工具页面合上，转向业务清单和流程图。",
        },
      ],
    } satisfies ScriptOutput;
  }

  if (stage === "shot_list") {
    const script = previous.script as ScriptOutput;
    const shots = script.script_sections.flatMap((section, sectionIndex) => {
      const count = section.duration_seconds >= 12 ? 3 : section.duration_seconds >= 8 ? 2 : 1;
      const baseDuration = Math.max(3, Math.round(section.duration_seconds / count));
      return Array.from({ length: count }, (_, shotIndex) => ({
        shot_id: `shot_${String(sectionIndex * 3 + shotIndex + 1).padStart(3, "0")}`,
        section_id: section.section_id,
        duration_seconds: shotIndex === count - 1 ? Math.max(3, section.duration_seconds - baseDuration * (count - 1)) : baseDuration,
        spoken_content_ref: section.spoken_content,
        visual_description:
          shotIndex === 0
            ? section.visual_intent
            : "同一办公室场景中的连续补充镜头，展示电脑、白板和业务清单的细节。",
        camera: shotIndex === 0 ? "中近景，轻微手持" : "近景或插入镜头，稳定轻推",
        motion: shotIndex === 0 ? "人物看向屏幕后停顿" : "镜头扫过笔记、表格或白板关键词",
        visual_role: section.narration_intent,
        composition_note:
          job.aspectRatio === "9:16"
            ? "主体置于画面中上部，文字和道具保持在安全区内。"
            : "主体和信息道具左右分布，保留足够留白。",
      }));
    });
    return { shots } satisfies ShotListOutput;
  }

  if (stage === "scene_blocks") {
    const shotList = previous.shot_list as ShotListOutput;
    const blocks: SceneBlockListOutput["scene_blocks"] = [];
    let cursor: typeof shotList.shots = [];
    let duration = 0;
    for (const shot of shotList.shots) {
      const wouldExceed = duration + shot.duration_seconds > 15;
      if (cursor.length > 0 && wouldExceed) {
        blocks.push(toBlock(blocks.length, cursor));
        cursor = [];
        duration = 0;
      }
      cursor.push(shot);
      duration += shot.duration_seconds;
      if (duration >= 8 && blocks.length < 8) {
        blocks.push(toBlock(blocks.length, cursor));
        cursor = [];
        duration = 0;
      }
    }
    if (cursor.length > 0) blocks.push(toBlock(blocks.length, cursor));
    return { scene_blocks: blocks } satisfies SceneBlockListOutput;
  }

  if (stage === "keyframe_prompts") {
    const sceneBlockList = previous.scene_blocks as SceneBlockListOutput;
    return {
      keyframes: sceneBlockList.scene_blocks.map((block) => ({
        scene_block_id: block.scene_block_id,
        keyframe_strategy: block.keyframe_strategy,
        image_model: "gpt-image-2",
        image_size: job.aspectRatio === "9:16" ? "1080x1920" : "1920x1080",
        prompt: `A ${job.visualStyle} keyframe for ${job.aspectRatio} video. ${block.block_summary}. Keep one consistent realistic office, natural lighting, business owner, desk, laptop, notebook. No readable brand names.`,
      })),
    } satisfies KeyframePromptListOutput;
  }

  const sceneBlockList = previous.scene_blocks as SceneBlockListOutput;
  const keyframes = previous.keyframe_prompts as KeyframePromptListOutput | undefined;
  return {
    videos: sceneBlockList.scene_blocks.map((block) => {
      const reference = keyframes?.keyframes.find((item) => item.scene_block_id === block.scene_block_id);
      const slotDuration = Math.max(3, Math.floor(block.duration_seconds / block.shot_ids.length));
      const sequence = block.shot_ids
        .map((shotId, index) => {
          const start = index * slotDuration;
          const end = index === block.shot_ids.length - 1 ? block.duration_seconds : (index + 1) * slotDuration;
          return `${start}-${end}s: connected shot ${shotId}, realistic office action, natural camera movement.`;
        })
        .join("\n");
      return {
        scene_block_id: block.scene_block_id,
        video_model: "seedance2",
        duration_seconds: block.duration_seconds,
        aspect_ratio: job.aspectRatio,
        reference_images: [{ type: "first_frame", url: reference?.image_url ?? `/mock/keyframe-${block.scene_block_id}.svg` }],
        video_prompt: `Create a ${block.duration_seconds}-second ${job.aspectRatio} ${job.visualStyle} clip based on the reference image.\n${sequence}\nAudio: ${block.audio_intent}\nKeep character, scene, lighting and tone consistent.`,
        video_url: "",
        status: "pending",
      };
    }),
  } satisfies VideoPromptListOutput;
}

function toBlock(index: number, shots: ShotListOutput["shots"]) {
  return {
    scene_block_id: `block_${String(index + 1).padStart(3, "0")}`,
    duration_seconds: clamp(
      shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
      5,
      15,
    ),
    shot_ids: shots.map((shot) => shot.shot_id),
    block_summary: shots.map((shot) => shot.visual_role).join(" / "),
    visual_continuity: "同一办公室、同一管理者、同一桌面和自然光线，保持现实短视频连续感。",
    audio_intent: "自然中文旁白，轻微办公室环境音，节奏稳定。",
    keyframe_strategy: shots.length >= 3 ? "first_frame_plus_last_frame" : "first_frame_only",
    generation_model: "seedance2",
  };
}

export async function generateKeyframe(sceneBlock: SceneBlockRecord, prompt: string) {
  return {
    id: uid("asset"),
    model: "gpt-image-2",
    url: `/api/mock/keyframe/${sceneBlock.id}`,
    prompt,
    metadata: {
      strategy: sceneBlock.keyframeStrategy,
      mock: true,
    },
  };
}

export async function generateSceneBlockVideo(sceneBlock: SceneBlockRecord, referenceImages: string[], prompt: string) {
  return {
    id: uid("asset"),
    model: sceneBlock.videoModel,
    url: `/api/mock/video/${sceneBlock.id}`,
    prompt,
    metadata: {
      referenceImages,
      mock: true,
      durationSeconds: sceneBlock.durationSeconds,
    },
  };
}
