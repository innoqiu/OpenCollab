import fs from "node:fs/promises";
import path from "node:path";

export const LOCAL_CONFIG_DIR = ".opencollab";
export const LOCAL_CONFIG_FILE = path.join(LOCAL_CONFIG_DIR, "current-project.json");
export const PROJECTS_FILE = path.join(LOCAL_CONFIG_DIR, "projects.json");
export const TASKS_DIR = "tasks";
export const DEFAULT_STATUS_FILE = "opencollab/Task_Status.json";
export const DEFAULT_TINY_STATUS_FILE = "opencollab/TTask_Status.json";
export const DEFAULT_SCHEMA_FILE = "opencollab/Task_Status.schema.json";
export const DEFAULT_BRIEF_FILE = "TASK_BRIEF.md";
export const TEMPLATE_STATUS_FILE = path.join("opencollab", "templates", "Task_Status.template.json");
export const TEMPLATE_TINY_STATUS_FILE = path.join("opencollab", "templates", "TTask_Status.template.json");
export const TEMPLATE_SCHEMA_FILE = path.join("opencollab", "Task_Status.schema.json");

export async function resolveProjectConfig(args = {}, options = {}) {
  const frameworkRoot = path.resolve(options.frameworkRoot ?? process.cwd());
  const localConfigPath = path.join(frameworkRoot, LOCAL_CONFIG_FILE);
  const projectsPath = path.join(frameworkRoot, PROJECTS_FILE);
  const saved = await readJsonIfExists(localConfigPath);
  const registry = await readProjectRegistry(frameworkRoot);
  const registryCurrent = registry.projects.find((project) => project.id === registry.current) ?? null;
  const base = saved ?? registryCurrent ?? null;
  const explicitRepoInput = firstValue(args.repo, args.repoUrl, args["repo-url"], args.url, args._?.[0]);
  const repoInput = firstValue(explicitRepoInput, process.env.OCB_PROJECT_REPO, base?.repo);
  const repoInfo = parseRepoInput(repoInput);
  const explicitProjectDir = firstValue(args.projectDir, args["project-dir"], args.project, process.env.OCB_PROJECT_DIR);
  const repoProjectDir = repoInfo ? path.join(TASKS_DIR, repoInfo.slug) : null;
  const projectDirInput = firstValue(
    explicitProjectDir,
    explicitRepoInput && repoProjectDir,
    base?.projectDir,
    base?.path,
    repoProjectDir,
    frameworkRoot
  );
  const projectRoot = path.resolve(frameworkRoot, projectDirInput);
  const projectId = sanitizeProjectId(args.id ?? args.projectId ?? base?.id ?? repoInfo?.slug ?? path.basename(projectRoot));
  const projectName = args.name ?? args.projectName ?? base?.name ?? repoInfo?.name ?? path.basename(projectRoot);
  const statusFile = firstValue(
    args.statusFile,
    args["status-file"],
    base?.statusFile,
    process.env.OCB_STATUS_FILE,
    DEFAULT_STATUS_FILE
  );
  const statusPath = path.isAbsolute(statusFile) ? statusFile : path.join(projectRoot, statusFile);
  const tinyStatusFile = firstValue(args.tinyStatusFile, args["tiny-status-file"], base?.tinyStatusFile, DEFAULT_TINY_STATUS_FILE);
  const tinyStatusPath = path.isAbsolute(tinyStatusFile) ? tinyStatusFile : path.join(projectRoot, tinyStatusFile);
  const schemaFile = firstValue(args.schemaFile, args["schema-file"], base?.schemaFile, DEFAULT_SCHEMA_FILE);
  const schemaPath = path.isAbsolute(schemaFile) ? schemaFile : path.join(projectRoot, schemaFile);
  const briefFile = firstValue(args.brief, args["brief-file"], base?.briefFile, process.env.OCB_BRIEF_FILE, DEFAULT_BRIEF_FILE);
  const briefPath = path.isAbsolute(briefFile) ? briefFile : path.join(projectRoot, briefFile);
  const repo = firstValue(args.repo, args.repoUrl, args["repo-url"], repoInfo?.canonical, base?.repo, process.env.OCB_PROJECT_REPO, "");
  const source = firstValue(args.source, args.url, base?.source, repoInfo?.cloneUrl, process.env.OCB_TASK_SOURCE, "");
  const fallbackStatusPath = path.join(frameworkRoot, TEMPLATE_STATUS_FILE);

  return {
    frameworkRoot,
    localConfigPath,
    projectsPath,
    projectRoot,
    projectDir: projectRoot,
    projectId,
    projectName,
    repo,
    repoInfo,
    source,
    statusFile,
    statusPath,
    tinyStatusFile,
    tinyStatusPath,
    schemaFile,
    schemaPath,
    briefFile,
    briefPath,
    fallbackStatusPath,
    templateStatusPath: path.join(frameworkRoot, TEMPLATE_STATUS_FILE),
    templateTinyStatusPath: path.join(frameworkRoot, TEMPLATE_TINY_STATUS_FILE),
    templateSchemaPath: path.join(frameworkRoot, TEMPLATE_SCHEMA_FILE),
    hasLocalConfig: Boolean(saved),
    hasRegistry: registry.projects.length > 0,
    usingFallbackStatus: !(await exists(statusPath)) && (await exists(fallbackStatusPath))
  };
}

export async function saveProjectConfig(config) {
  await fs.mkdir(path.dirname(config.localConfigPath), { recursive: true });
  const now = new Date().toISOString();
  const payload = projectRecord(config, now);
  await fs.writeFile(config.localConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await saveProjectRegistration(config, now);
  return payload;
}

export async function saveProjectRegistration(config, updatedAt = new Date().toISOString()) {
  const registry = await readProjectRegistry(config.frameworkRoot);
  const nextProject = projectRecord(config, updatedAt);
  const projects = registry.projects.filter((project) => project.id !== nextProject.id);
  projects.push(nextProject);
  projects.sort((a, b) => a.name.localeCompare(b.name));
  const payload = { current: nextProject.id, projects };
  await fs.mkdir(path.dirname(config.projectsPath), { recursive: true });
  await fs.writeFile(config.projectsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export async function readProjectRegistry(frameworkRoot = process.cwd()) {
  const registryPath = path.join(path.resolve(frameworkRoot), PROJECTS_FILE);
  const registry = await readJsonIfExists(registryPath);
  if (!registry) return { current: "", projects: [] };
  return {
    current: registry.current ?? "",
    projects: Array.isArray(registry.projects) ? registry.projects : []
  };
}

export async function listRegisteredProjects(frameworkRoot = process.cwd()) {
  const registry = await readProjectRegistry(frameworkRoot);
  return registry.projects.map((project) => ({
    ...project,
    current: project.id === registry.current
  }));
}

export async function findRegisteredProject(identifier, frameworkRoot = process.cwd()) {
  const normalized = String(identifier ?? "").trim();
  if (!normalized) return null;
  const registry = await readProjectRegistry(frameworkRoot);
  const absolute = path.resolve(frameworkRoot, normalized);
  return (
    registry.projects.find((project) => {
      const projectPath = path.resolve(frameworkRoot, project.projectDir ?? project.path ?? "");
      return (
        project.id === normalized ||
        project.name === normalized ||
        project.repo === normalized ||
        project.projectDir === normalized ||
        project.path === normalized ||
        projectPath === absolute
      );
    }) ?? null
  );
}

export async function ensureProjectDirs(config) {
  await fs.mkdir(path.dirname(config.statusPath), { recursive: true });
}

export async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export function parseRepoInput(input) {
  const value = String(input ?? "").trim();
  if (!value) return null;
  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(value);
  const httpsMatch = /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(value);
  const shorthandMatch = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(value);
  const match = sshMatch ?? httpsMatch ?? shorthandMatch;
  if (!match) return null;
  const owner = match[1];
  const name = match[2].replace(/\.git$/i, "");
  const canonical = `${owner}/${name}`;
  return {
    owner,
    name,
    canonical,
    slug: sanitizeProjectId(`${owner}__${name}`),
    cloneUrl: `https://github.com/${owner}/${name}.git`
  };
}

export function inferProjectDirFromRepo(repoInput, frameworkRoot = process.cwd()) {
  const repoInfo = parseRepoInput(repoInput);
  if (!repoInfo) return null;
  return path.join(path.resolve(frameworkRoot), TASKS_DIR, repoInfo.slug);
}

export function projectRecord(config, updatedAt = new Date().toISOString()) {
  const relativeProjectDir = path.relative(config.frameworkRoot, config.projectRoot) || ".";
  return {
    id: config.projectId,
    name: config.projectName,
    projectDir: relativeProjectDir.replace(/\\/g, "/"),
    repo: config.repo,
    source: config.source,
    statusFile: config.statusFile,
    tinyStatusFile: config.tinyStatusFile,
    schemaFile: config.schemaFile,
    briefFile: config.briefFile,
    updatedAt
  };
}

function sanitizeProjectId(input) {
  return String(input ?? "project")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "project";
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

async function readJsonIfExists(target) {
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
