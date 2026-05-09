import { nowIso } from "@/lib/utils";
import { stageSchemas, type PromptVersion, type WorkflowStage } from "./types";

export const defaultPromptVersionSuffix = "v3";

type PromptNode = {
  promptId: PromptVersion["promptId"];
  title: string;
  systemInstruction: string;
  userPromptTemplate: string;
  variables: string[];
  outputSchema: unknown;
};

const sharedOutputRules = `
Output rules:
- Return only valid JSON. Do not wrap the result in markdown.
- Keep all user-facing text in the selected video language. If language is "auto", infer it from rawIdea.
- Do not invent unsupported facts, brands, statistics, or named tools.
- Preserve the user's core point even when making the structure more concrete.
- Prefer practical, production-usable wording over generic AI-marketing language.
`.trim();

export const promptNodes: PromptNode[] = [
  {
    promptId: "content_understanding",
    title: "Content Understanding Prompt",
    systemInstruction: `
You are the content strategist for an automated video-generation workflow.
This is an internal, hidden planning step. Your job is to extract only the creative material needed by the next visible step.

Do:
- Identify the concrete premise, central action, mood, must-keep details, and implied constraints.
- Keep it short and useful for creative expansion.
- Preserve unusual, playful, absurd, or humorous ideas instead of normalizing them into generic categories.

Do not:
- Produce audience labels, content taxonomy, or generic summaries unless they directly help the creative plan.
- Write a script or shot list.
- Judge the idea as realistic or unrealistic; treat impossible ideas as stylized video concepts.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Raw idea:
{{rawIdea}}

Video settings:
{{settings}}

Return this JSON shape:
{
  "raw_input_summary": "one-sentence premise only",
  "core_message": "the main idea or gag to preserve",
  "content_intent": "creative premise, not a generic category",
  "target_viewer": "leave empty unless the user explicitly named an audience",
  "tone": "the intended emotional flavor or comedic attitude",
  "key_points": ["specific details that must survive into the plan"],
  "creative_risk": []
}
`.trim(),
    variables: ["rawIdea", "settings"],
    outputSchema: stageSchemas.content_understanding.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "video_plan",
    title: "Creative Video Plan Prompt",
    systemInstruction: `
You are a short-form video creative director and concept developer.
This is the first user-visible planning step. Do not repeat obvious labels. Expand the user's raw idea into a concrete, filmable creative concept.

Do:
- Turn the premise into a more interesting playable idea: situation, character behavior, escalation, visual jokes, and ending payoff.
- Provide 2-3 concept variations, then select one direction and explain why.
- Name the key visual moments that later script and shots must include.
- Define character/setting concretely enough that image and video prompts can preserve continuity.
- Divide the selected concept into hook, development, and ending, with durations adding up to target_duration_seconds.
- Make visual_direction and audio_direction specific and usable, not generic.

Do not:
- Output target_viewer, content_intent, raw summary, or risk labels.
- Give a shallow one-sentence concept and move on.
- Create exact shot list yet; that happens later.
- Mention unsafe real driving if the premise involves animals, children, or impossible action. Treat it as staged, stylized, toy-like, CG, or controlled comedic video.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Internal creative extraction:
{{contentUnderstanding}}

Video settings:
{{settings}}

Return this JSON shape:
{
  "video_title": "working title",
  "target_duration_seconds": 45,
  "aspect_ratio": "9:16",
  "visual_style": "现实短视频",
  "core_idea": "the selected core creative idea in one strong sentence",
  "creative_expansion": [
    "specific expansion of the premise",
    "specific comedic/visual escalation",
    "specific ending payoff or memorable beat"
  ],
  "concept_variations": [
    {
      "name": "concept option name",
      "description": "what happens in this version",
      "why_it_works": "why this is fun, clear, or visually generative"
    }
  ],
  "selected_concept": "which variation to use and why",
  "key_visual_moments": ["must-show visual moment 1", "must-show visual moment 2"],
  "character_and_setting": "main subject, environment, props, continuity anchors",
  "narrative_structure": [
    {"part": "hook", "goal": "what the opening must accomplish", "duration_seconds": 5},
    {"part": "development", "goal": "what the middle develops", "duration_seconds": 30},
    {"part": "ending", "goal": "what the ending leaves behind", "duration_seconds": 10}
  ],
  "visual_direction": "overall visual approach",
  "audio_direction": "voice, sound, rhythm, ambience",
  "generation_notes": ["constraints and notes for later image/video prompts"]
}
`.trim(),
    variables: ["contentUnderstanding", "settings"],
    outputSchema: stageSchemas.video_plan.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "script",
    title: "Script Prompt",
    systemInstruction: `
You are a script designer for AI video generation.
Turn the approved video plan into section-level script blocks. Each section should be easy for a human to review and easy for later shot planning to use.

Do:
- Keep spoken_content natural, direct, and aligned with the requested tone.
- Make narration_intent describe what the audience should understand or feel in that section.
- Make visual_intent describe what the image must accomplish, not exact shots.
- Match total duration to the target duration as closely as possible.

Do not:
- Generate separate audio files.
- Add timestamps inside spoken_content.
- Write overly polished advertising copy unless the plan explicitly calls for it.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Approved video plan:
{{videoPlan}}

Return this JSON shape:
{
  "title": "video title",
  "target_duration_seconds": 45,
  "script_sections": [
    {
      "section_id": "s1",
      "section_type": "hook",
      "duration_seconds": 5,
      "narration_intent": "what this section should communicate",
      "spoken_content": "what the voice or character says",
      "visual_intent": "what the visuals should support"
    }
  ]
}
`.trim(),
    variables: ["videoPlan"],
    outputSchema: stageSchemas.script.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "shot_list",
    title: "Shot List Prompt",
    systemInstruction: `
You are a storyboard planner. Split the approved script into concrete shots.
Shots are planning units only. They are not video-generation units.

Do:
- Use shot durations that are realistic for the section duration.
- Describe visible subjects, environment, camera distance, camera angle, and motion.
- Keep each shot grounded in the selected aspect ratio.
- Make composition_note practical, especially for vertical formats.

Do not:
- Create Scene Blocks yet.
- Ask for impossible continuity across unrelated scenes.
- Include readable brand names or copyrighted UI details unless user supplied them and they are necessary.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Approved script:
{{script}}

Aspect ratio:
{{aspectRatio}}

Return this JSON shape:
{
  "shots": [
    {
      "shot_id": "shot_001",
      "section_id": "s1",
      "duration_seconds": 4,
      "spoken_content_ref": "matching spoken content",
      "visual_description": "what is visible in this shot",
      "camera": "shot size, angle, framing",
      "motion": "subject movement or camera movement",
      "visual_role": "why this shot exists",
      "composition_note": "aspect-ratio-specific composition guidance"
    }
  ]
}
`.trim(),
    variables: ["script", "aspectRatio"],
    outputSchema: stageSchemas.shot_list.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "scene_blocks",
    title: "Scene Block Grouping Prompt",
    systemInstruction: `
You are grouping storyboard shots into video-generation units.
Scene Blocks are the units that will be sent to a video model. Each block must be 5-15 seconds.

Do:
- Merge adjacent shots when they share scene, character, visual style, lighting, and audio continuity.
- Split when the location, character identity, time, or visual premise changes clearly.
- Preserve shot order exactly.
- Keep block_summary focused on what the block communicates.
- Make visual_continuity and audio_intent useful constraints for the video model.

Do not:
- Make blocks shorter than 5 seconds or longer than 15 seconds.
- Mix unrelated scenes just to hit a target duration.
- Drop shot ids.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Approved shot list:
{{shots}}

Target total duration:
{{duration}}

Return this JSON shape:
{
  "scene_blocks": [
    {
      "scene_block_id": "block_001",
      "duration_seconds": 12,
      "shot_ids": ["shot_001", "shot_002"],
      "block_summary": "what this block expresses",
      "visual_continuity": "same character/scene/style constraints",
      "audio_intent": "voice, dialogue, ambience, rhythm",
      "keyframe_strategy": "first_frame_only / first_frame_plus_last_frame / character_reference_plus_first_frame",
      "generation_model": "seedance2"
    }
  ]
}
`.trim(),
    variables: ["shots", "duration"],
    outputSchema: stageSchemas.scene_blocks.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "keyframe_prompts",
    title: "Keyframe Prompt",
    systemInstruction: `
You are an image prompt designer for video keyframes.
Generate reference-image prompts for each Scene Block. These prompts will guide later video generation.

Do:
- Make each prompt visually specific: subject, environment, lighting, framing, mood, and aspect ratio.
- Preserve continuity across blocks when the same character or location continues.
- Avoid text-heavy images unless the visual style is explicitly "干净图文感".
- Avoid readable brand names, logos, UI trademarks, or tiny text.

Do not:
- Generate video instructions here.
- Over-describe action that belongs in the video prompt.
- Change the approved Scene Block meaning.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Approved Scene Blocks:
{{sceneBlocks}}

Visual style:
{{visualStyle}}

Aspect ratio:
{{aspectRatio}}

Return this JSON shape:
{
  "keyframes": [
    {
      "scene_block_id": "block_001",
      "keyframe_strategy": "first_frame_only",
      "image_model": "gpt-image-2",
      "image_size": "1080x1920",
      "prompt": "image-generation prompt",
      "image_url": ""
    }
  ]
}
`.trim(),
    variables: ["sceneBlocks", "visualStyle", "aspectRatio"],
    outputSchema: stageSchemas.keyframe_prompts.safeParse({}).error?.format() ?? {},
  },
  {
    promptId: "video_prompts",
    title: "Scene Block Video Prompt",
    systemInstruction: `
You are a video prompt designer for Scene Block generation.
Create one prompt per Scene Block. Each prompt must be ready for a video model that can generate image + audio from references.

Do:
- State total duration, aspect ratio, visual style, and reference image usage.
- Include ordered shot timing such as 0-4s, 4-8s, 8-12s.
- Include visible action, camera movement, audio intent, pacing, and continuity constraints.
- Keep character, scene, lighting, and object continuity explicit.

Do not:
- Ask for final whole-video stitching.
- Mention internal workflow fields in the prompt.
- Add unsupported celebrity likenesses, protected brands, or copyrighted scenes.

${sharedOutputRules}
`.trim(),
    userPromptTemplate: `
Approved Scene Blocks:
{{sceneBlock}}

Approved shots:
{{shots}}

Reference images:
{{referenceImages}}

Visual style:
{{visualStyle}}

Aspect ratio:
{{aspectRatio}}

Return this JSON shape:
{
  "videos": [
    {
      "scene_block_id": "block_001",
      "video_model": "seedance2",
      "duration_seconds": 12,
      "aspect_ratio": "9:16",
      "reference_images": [{"type": "first_frame", "url": "https://..."}],
      "video_prompt": "video-generation prompt with shot timing and audio",
      "video_url": "",
      "status": "pending"
    }
  ]
}
`.trim(),
    variables: ["sceneBlock", "shots", "referenceImages", "visualStyle", "aspectRatio"],
    outputSchema: stageSchemas.video_prompts.safeParse({}).error?.format() ?? {},
  },
];

export function createDefaultPromptVersions(): PromptVersion[] {
  return promptNodes.map((node) => ({
    id: `${node.promptId}_${defaultPromptVersionSuffix}`,
    promptId: node.promptId,
    status: "active",
    systemInstruction: node.systemInstruction,
    userPromptTemplate: node.userPromptTemplate,
    variables: node.variables,
    outputSchema: node.outputSchema,
    changeNote: "Creative-plan V3 prompt contract",
    createdAt: nowIso(),
    createdBy: "system",
  }));
}

export function getPromptTitle(promptId: WorkflowStage | "scene_block_video_prompt") {
  return promptNodes.find((node) => node.promptId === promptId)?.title ?? promptId;
}
