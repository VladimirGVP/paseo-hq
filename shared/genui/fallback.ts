import {
  collectLoads,
  compile,
  compileStreaming,
  dataKey,
  evaluate,
  formatDiagnostics,
  imageSearches,
  initialState,
  specToMarkdown,
  type DataRequest,
  type LoadedData,
  type SearchedImage,
} from "./core";
import { projectRequests, toMarkdownWithProject } from "./core/markdown";
import { projectRequestKey, type ProjectRequest, type ProjectResult } from "./core/project";
import type { UiNode } from "./core/types";

type Loader = (request: DataRequest) => Promise<LoadedData>;
type ImageFinder = (query: string) => Promise<SearchedImage | null>;
export type ProjectReader = (request: ProjectRequest) => Promise<ProjectResult>;

async function findImages(roots: readonly UiNode[], find: ImageFinder | undefined): Promise<Map<string, SearchedImage | null>> {
  if (find === undefined) return new Map();
  return new Map(await Promise.all(imageSearches(roots).map(async (query) => [query, await find(query)] as const)));
}

async function rootsMarkdown(roots: readonly UiNode[], find: ImageFinder | undefined, project: ProjectReader | undefined): Promise<string> {
  const requests = project === undefined ? [] : projectRequests(roots);
  const [images, answers] = await Promise.all([
    findImages(roots, find),
    Promise.all(requests.map(async (request) => [projectRequestKey(request), await project!(request)] as const)),
  ]);
  return toMarkdownWithProject(roots, images, new Map(answers));
}

export interface Fence {
  open: number;
  close: number;
  language: string;
  body: string;
  closed: boolean;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/;

export function findFences(lines: readonly string[]): Fence[] {
  const fences: Fence[] = [];
  for (let index = 0; index < lines.length; index++) {
    const open = FENCE_OPEN.exec(lines[index] ?? "");
    if (open === null) continue;
    const marker = open[1] ?? "```";
    const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    let close = index + 1;
    while (close < lines.length && !closing.test(lines[close] ?? "")) close++;
    fences.push({
      open: index,
      close,
      language: (open[2] ?? "").toLowerCase(),
      body: lines.slice(index + 1, close).join("\n"),
      closed: close < lines.length,
    });
    index = close;
  }
  return fences;
}

function appPointer(html: string): string {
  const title = /<title>([^<]{1,120})<\/title>/i.exec(html)?.[1]?.trim();
  return `_Interactive app${title ? `: ${title}` : ""}. Open this reply in Paseo to use it._`;
}

async function uiMarkdown(spec: string, load: Loader, find: ImageFinder | undefined, project: ProjectReader | undefined): Promise<string> {
  const { program } = compileStreaming(spec);
  const requests = program === null ? [] : collectLoads(program);
  const data = new Map(await Promise.all(requests.map(async (request) => [dataKey(request), await load(request)] as const)));
  const compiled = compile(spec);
  if (compiled.program === null) return specToMarkdown(spec, data);
  const { roots } = evaluate(compiled.program, initialState(compiled.program, data), data);
  return rootsMarkdown(roots, find, project);
}

export async function renderReplyMarkdown(text: string, load: Loader, find?: ImageFinder, project?: ProjectReader): Promise<string> {
  const lines = text.split("\n");
  const fences = findFences(lines).filter((fence) => fence.language === "ui" || fence.language === "app");
  if (fences.length === 0) return text;
  const output: string[] = [];
  let next = 0;
  for (const fence of fences) {
    output.push(...lines.slice(next, fence.open));
    output.push(fence.language === "app" ? appPointer(fence.body) : await uiMarkdown(fence.body, load, find, project));
    next = fence.close + 1;
  }
  output.push(...lines.slice(next));
  return output.join("\n");
}

const LAYOUT = new Set(["Card", "Row", "Stack", "Grid", "Tabs", "Details", "Divider", "Carousel"]);

function nodeTypes(value: unknown, types: Set<string>): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => nodeTypes(item, types));
  else if (value !== null && typeof value === "object" && (value as UiNode).kind === "node") {
    types.add((value as UiNode).type);
    Object.values((value as UiNode).props).forEach((prop) => nodeTypes(prop, types));
  }
  return types;
}

/** Buttons with nothing beside them, in a render_ui card: the findings and options they act on ended up in the agent's reasoning, which the user never sees. */
export function actionsOnly(roots: readonly UiNode[]): boolean {
  const types = [...nodeTypes(roots, new Set())].filter((type) => !LAYOUT.has(type));
  return types.length > 0 && types.every((type) => type === "Button" || type === "Other");
}

/** What is wrong with a spec: compile errors, files that failed to load, and evaluation errors. Empty when it renders cleanly. */
export async function specProblems(spec: string, load: Loader): Promise<{ problems: string[]; roots: UiNode[] | null }> {
  const compiled = compile(spec);
  if (compiled.program === null) {
    return { problems: [`The block does not compile:\n${formatDiagnostics(compiled.diagnostics)}`], roots: null };
  }
  const requests = collectLoads(compiled.program);
  const loaded = await Promise.all(requests.map(async (request) => [request, await load(request)] as const));
  const data = new Map(loaded.map(([request, result]) => [dataKey(request), result] as const));
  const { roots, diagnostics } = evaluate(compiled.program, initialState(compiled.program, data), data);
  const problems = [
    ...loaded.flatMap(([request, result]) => (result.ok ? [] : [`${request.path}: ${result.error}`])),
    ...(diagnostics.length > 0 ? [formatDiagnostics(diagnostics)] : []),
  ];
  return { problems, roots };
}

export async function checkSpec(
  spec: string,
  load: Loader,
  find?: ImageFinder,
  project?: ProjectReader,
): Promise<{ readonly ok: boolean; readonly report: string }> {
  const { problems, roots } = await specProblems(spec, load);
  if (roots === null) return { ok: false, report: problems[0] };
  const preview = `Text version of what the user will see:\n\n${await rootsMarkdown(roots, find, project)}`;
  return problems.length === 0
    ? { ok: true, report: `No errors. ${preview}` }
    : { ok: false, report: `Fix before replying:\n${problems.join("\n")}\n\n${preview}` };
}

export const REPAIR_MARKER = "[genui]";

/** The follow-up that asks the agent to rewrite the ```ui blocks of `reply` that fail, or null when they all render. */
export async function repairRequest(reply: string, load: Loader): Promise<string | null> {
  const fences = findFences(reply.split("\n")).filter((fence) => fence.language === "ui" && fence.closed);
  const failures: string[] = [];
  for (const [index, fence] of fences.entries()) {
    const { problems } = await specProblems(fence.body, load);
    if (problems.length > 0) failures.push(`Block ${index + 1}:\n${problems.join("\n")}`);
  }
  if (failures.length === 0) return null;
  return [
    `${REPAIR_MARKER} Your last reply has \`\`\`ui blocks the user sees as errors:`,
    ...failures,
    "Send the corrected blocks only, using components from the Inline UI reference. Do not explain the fix.",
  ].join("\n\n");
}
