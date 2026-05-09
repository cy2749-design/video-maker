import { stageSchemas, type PromptVersion, type WorkflowStage } from "./types";
import { nowIso } from "@/lib/utils";

type PromptNode = {
  promptId: PromptVersion["promptId"];
  title: string;
  systemInstruction: string;
  userPromptTemplate: string;
  variables: string[];
  outputSchema: unknown;
};

export const promptNodes: PromptNode[] = [
  {
    promptId: "content_understanding",
    title: "Content Understanding Prompt",
    systemInstruction: "把用户的视频想法整理成稳定、可编辑的结构化内容，不扩写成脚本。",
    userPromptTemplate: "输入想法：{{rawIdea}}\n参数：{{settings}}",
    variables: ["rawIdea", "settings"],
    outputSchema: stageSchemas.content_understanding.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "video_plan",
    title: "Video Plan Prompt",
    systemInstruction: "根据内容理解和参数生成整体视频方案，保证时长分配清楚。",
    userPromptTemplate: "内容理解：{{contentUnderstanding}}\n参数：{{settings}}",
    variables: ["contentUnderstanding", "settings"],
    outputSchema: stageSchemas.video_plan.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "script",
    title: "Script Prompt",
    systemInstruction: "把视频方案转成可被视频模型理解的分段脚本。",
    userPromptTemplate: "视频方案：{{videoPlan}}",
    variables: ["videoPlan"],
    outputSchema: stageSchemas.script.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "shot_list",
    title: "Shot List Prompt",
    systemInstruction: "把脚本拆成镜头。镜头只用于规划，不直接调用视频模型。",
    userPromptTemplate: "脚本：{{script}}",
    variables: ["script", "aspectRatio"],
    outputSchema: stageSchemas.shot_list.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "scene_blocks",
    title: "Scene Block Grouping Prompt",
    systemInstruction: "把连续镜头组合成 5-15 秒 Scene Block，同场景优先合并。",
    userPromptTemplate: "镜头列表：{{shots}}\n总时长：{{duration}}",
    variables: ["shots", "duration"],
    outputSchema: stageSchemas.scene_blocks.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "keyframe_prompts",
    title: "Keyframe Prompt",
    systemInstruction: "为每个 Scene Block 生成关键帧图片 prompt。",
    userPromptTemplate: "Scene Blocks：{{sceneBlocks}}\n视觉风格：{{visualStyle}}",
    variables: ["sceneBlocks", "visualStyle", "aspectRatio"],
    outputSchema: stageSchemas.keyframe_prompts.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "video_prompts",
    title: "Scene Block Video Prompt",
    systemInstruction: "把 Scene Block、shot 顺序和参考图整理成视频生成 prompt。",
    userPromptTemplate: "Scene Block：{{sceneBlock}}\n参考图：{{referenceImages}}",
    variables: ["sceneBlock", "shots", "referenceImages", "visualStyle", "aspectRatio"],
    outputSchema: stageSchemas.video_prompts.safeParse({}).error?.format() ?? {},
  },
];

export function createDefaultPromptVersions(): PromptVersion[] {
  return promptNodes.map((node) => ({
    id: `${node.promptId}_v1`,
    promptId: node.promptId,
    status: "active",
    systemInstruction: node.systemInstruction,
    userPromptTemplate: node.userPromptTemplate,
    variables: node.variables,
    outputSchema: node.outputSchema,
    changeNote: "Initial V1 prompt contract",
    createdAt: nowIso(),
    createdBy: "system",
  }));
}

export function getPromptTitle(promptId: WorkflowStage | "scene_block_video_prompt") {
  return promptNodes.find((node) => node.promptId === promptId)?.title ?? promptId;
}
