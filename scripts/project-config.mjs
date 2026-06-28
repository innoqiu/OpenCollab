import fs from "node:fs/promises";
import path from "node:path";

export const LOCAL_CONFIG_DIR = ".opencollab";
export const LOCAL_CONFIG_FILE = path.join(LOCAL_CONFIG_DIR, "current-project.json");
export const DEFAULT_STATUS_FILE = "opencollab/Task_Status.json";
export const DEFAULT_BRIEF_FILE = "TASK_BRIEF.md";
export const TEMPLATE_STATUS_FILE = path.join("opencollab", "templates", "Task_Status.template.json");

export async function resolveProjectConfig(args = {}, options = {}) {
  const frameworkRoot = path.resolve(options.frameworkRoot ?? process.cwd());
  const localConfigPath = path.join(frameworkRoot, LOCAL_CONFIG_FILE);
  const saved = await readJsonIfExists(localConfigPath);

  const projectDirInput =
    args.projectDir ??
    args["project-dir"] ??
    args.project ??
    process.env.OCB_PROJECT_DIR ??
    saved?.projectDir ??
    frameworkRoot;

  const projectRoot = path.resolve(frameworkRoot, projectDirInput);
  const statusFile =
    args.statusFile ??
    args["status-file"] ??
    saved?.statusFile ??
    process.env.OCB_STATUS_FILE ??
    DEFAULT_STATUS_FILE;
  const statusPath = path.isAbsolute(statusFile) ? statusFile : path.join(projectRoot, statusFile);
  const briefFile =
    args.brief ??
    args["brief-file"] ??
    saved?.briefFile ??
    process.env.OCB_BRIEF_FILE ??
    DEFAULT_BRIEF_FILE;
  const briefPath = path.isAbsolute(briefFile) ? briefFile : path.join(projectRoot, briefFile);
  const fallbackStatusPath = path.join(frameworkRoot, TEMPLATE_STATUS_FILE);

  return {
    frameworkRoot,
    localConfigPath,
    projectRoot,
    projectDir: projectRoot,
    repo: args.repo ?? args.repoUrl ?? args["repo-url"] ?? saved?.repo ?? process.env.OCB_PROJECT_REPO ?? "",
    source: args.source ?? args.url ?? saved?.source ?? process.env.OCB_TASK_SOURCE ?? "",
    statusFile,
    statusPath,
    briefFile,
    briefPath,
    fallbackStatusPath,
    hasLocalConfig: Boolean(saved),
    usingFallbackStatus: !(await exists(statusPath)) && (await exists(fallbackStatusPath))
  };
}

export async function saveProjectConfig(config) {
  await fs.mkdir(path.dirname(config.localConfigPath), { recursive: true });
  const payload = {
    projectDir: config.projectRoot,
    repo: config.repo,
    source: config.source,
    statusFile: config.statusFile,
    briefFile: config.briefFile,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(config.localConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
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

async function readJsonIfExists(target) {
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
