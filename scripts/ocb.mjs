import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BRIEF_FILE,
  DEFAULT_SCHEMA_FILE,
  DEFAULT_STATUS_FILE,
  DEFAULT_TINY_STATUS_FILE,
  TASKS_DIR,
  ensureProjectDirs,
  exists,
  findRegisteredProject,
  listRegisteredProjects,
  parseRepoInput,
  resolveProjectConfig,
  saveProjectConfig
} from "./project-config.mjs";

const defaultBoard = { cols: 14, rows: 12 };
const defaultCategory = { id: "general", label: "General", color: "#7d838f" };
const command = (process.argv[2] ?? "help").toLowerCase();
const args = parseArgs(process.argv.slice(3));

if (command === "help") {
  printHelp();
  process.exit(0);
}

if (command === "list" || command === "projects") {
  await printProjects();
  process.exit(0);
}

if (command === "use") {
  const identifier = args._[0] ?? args.project ?? args.id;
  const project = await findRegisteredProject(identifier);
  if (!project) {
    console.error(`OpenCollab project not found: ${identifier || "(missing id)"}`);
    console.error("Run npm run ocb -- list to see registered projects.");
    process.exit(1);
  }
  const config = await resolveProjectConfig(recordToArgs(project));
  await saveProjectConfig(config);
  console.log(`Using OpenCollab project: ${config.projectName}`);
  console.log(`Task folder: ${config.projectRoot}`);
  console.log(`Status file: ${config.statusPath}`);
  process.exit(0);
}

if (command === "status") {
  const config = await resolveProjectConfig(args);
  console.log(JSON.stringify(projectSummary(config), null, 2));
  process.exit(0);
}

if (command === "def") {
  const config = await configureTarget(args, { initialize: false, clone: true, pull: false });
  await updateActorDefinition(config, args);
  process.exit(0);
}

if (command === "init") {
  const config = await configureTarget(args, {
    initialize: true,
    clone: true,
    pull: !truthy(args.noPull),
    force: truthy(args.force)
  });
  printConfiguredProject(config);
  if (!truthy(args.noDev)) await startDevServer();
  process.exit(0);
}

if (command === "run") {
  const config = await resolveProjectConfig(args);
  if (!config.hasLocalConfig && !config.hasRegistry && !config.repoInfo && !truthy(args.projectDir)) {
    console.error("No OpenCollab task project is configured yet.");
    console.error("Run: npm run ocb -- init <github-repo-url>");
    process.exit(1);
  }
  printConfiguredProject(config);
  await startDevServer();
  process.exit(0);
}

if (command === "pull") {
  const config = await resolveProjectConfig(args);
  await run("git", ["pull", "--ff-only"], { inherit: true, cwd: config.projectRoot });
  process.exit(0);
}

if (command === "push") {
  const config = await resolveProjectConfig(args);
  const status = normalizeStatus(JSON.parse(await fs.readFile(config.statusPath, "utf8")));
  appendPushUpdate(status);
  await writeStatus(config, status);
  const jsonDataset = await collectJsonDataset(config);
  if (jsonDataset.length) await run("git", ["add", ...jsonDataset], { inherit: true, cwd: config.projectRoot });
  await run("git", ["commit", "-m", "Update OpenCollab task status dataset"], {
    inherit: true,
    allowFailure: true,
    cwd: config.projectRoot
  });
  await run("git", ["push"], { inherit: true, cwd: config.projectRoot });
  process.exit(0);
}

if (command === "mtg") {
  const config = await resolveProjectConfig(args);
  const status = normalizeStatus(JSON.parse(await fs.readFile(config.statusPath, "utf8")));
  const actorId = args.actor ?? status.workspace.currentActorId;
  const taskIds = String(args.task ?? args.tasks ?? "")
    .split(",")
    .map((task) => task.trim())
    .filter(Boolean);
  const title = args.title ?? "OpenCollab meeting";
  const notes = args.notes ?? (taskIds.length ? `Meeting marker for ${taskIds.join(", ")}.` : "Meeting marker created from /ocb mtg.");
  const meeting = {
    id: `mtg-${Date.now()}`,
    title,
    taskIds,
    notes,
    createdAt: new Date().toISOString()
  };
  status.meetings = [meeting, ...(status.meetings ?? [])];
  status.timeline = [
    {
      id: `tl-${Date.now()}`,
      type: "meeting",
      actorId,
      taskIds,
      title,
      details: notes,
      createdAt: meeting.createdAt,
      adds: ["meetings[]", "timeline[]"]
    },
    ...(status.timeline ?? [])
  ];
  status.workspace.updatedAt = new Date().toISOString();
  await writeStatus(config, status);
  console.log(`Added meeting marker: ${title}`);
  process.exit(0);
}

console.error(`Unknown OpenCollab helper command: ${command}`);
process.exit(1);

async function configureTarget(options, mode = {}) {
  const repoInput = firstValue(options.repo, options.repoUrl, options.url, options._?.[0]);
  const hasExplicitTarget = Boolean(repoInput || options.projectDir || options.project || options["project-dir"]);
  if (!hasExplicitTarget && mode.initialize) {
    const current = await resolveProjectConfig(options);
    if (!current.hasLocalConfig && !current.hasRegistry) {
      console.error("OpenCollab needs a task repo URL or project folder for the first init.");
      console.error("Example: npm run ocb -- init https://github.com/innoqiu/DemoOpenColl2.git");
      process.exit(1);
    }
  }

  const config = await resolveProjectConfig(options);
  await ensureProjectRoot(config, { clone: mode.clone, pull: mode.pull });
  if (mode.initialize) await ensureTaskDataset(config, { force: mode.force });
  await writeThinProtocolFiles(config, { force: truthy(options.forceProtocol) });
  await ensureProjectDirs(config);
  await saveProjectConfig(config);
  return config;
}

async function ensureProjectRoot(config, options = {}) {
  const parentDir = path.dirname(config.projectRoot);
  await fs.mkdir(parentDir, { recursive: true });
  if (!(await exists(config.projectRoot))) {
    if (options.clone && config.repoInfo) {
      await run("git", ["clone", config.repoInfo.cloneUrl, config.projectRoot], { inherit: true, cwd: config.frameworkRoot });
    } else {
      await fs.mkdir(config.projectRoot, { recursive: true });
    }
  } else if (options.pull && config.repoInfo && (await exists(path.join(config.projectRoot, ".git")))) {
    await run("git", ["pull", "--ff-only"], { inherit: true, cwd: config.projectRoot });
  }
}

async function ensureTaskDataset(config, options = {}) {
  await fs.mkdir(config.projectRoot, { recursive: true });
  await fs.mkdir(path.join(config.projectRoot, "opencollab"), { recursive: true });
  await copyIfMissing(config.templateSchemaPath, config.schemaPath, options);
  if (!(await exists(config.briefPath))) {
    const brief = [
      `# ${config.projectName} Task Brief`,
      "",
      "Replace this starter brief with the shared assignment, deliverables, constraints, and team context.",
      "",
      "OpenCollab will use this file as the first project-specific read during `/ocb init`."
    ].join("\n");
    await fs.writeFile(config.briefPath, `${brief}\n`, "utf8");
  }
  await writeJsonIfMissing(config.tinyStatusPath, () => buildTinyStatus(config), options);
  await writeJsonIfMissing(config.statusPath, () => buildTaskStatus(config), options);
  await refreshTaskMetadata(config);
}

async function writeThinProtocolFiles(config, options = {}) {
  const relativeRoot = normalizeRelativePath(path.relative(config.projectRoot, config.frameworkRoot) || ".");
  const relativeProject = normalizeRelativePath(path.relative(config.frameworkRoot, config.projectRoot) || ".");
  const agentContent = [
    "# OpenCollab Task Workspace",
    "",
    "This folder is a task project managed by a parent OpenCollab tool repo.",
    "",
    `- OpenCollab tool repo: \`${relativeRoot}\``,
    `- Project id: \`${config.projectId}\``,
    `- Project status: \`${config.statusFile}\``,
    `- Project brief: \`${config.briefFile}\``,
    "",
    "Before acting on `/ocb`, read:",
    "",
    `1. \`${relativeRoot}/AGENTS.md\``,
    `2. \`${relativeRoot}/opencollab/PROTOCOL_COMMANDS.md\``,
    `3. \`${config.briefFile}\``,
    `4. \`${config.tinyStatusFile}\``,
    `5. \`${config.statusFile}\``,
    "",
    "When this folder is the agent workspace, treat its `opencollab/Task_Status.json` as the only project state to edit.",
    "For helper commands, run them from the parent OpenCollab repo and pass this project when needed:",
    "",
    "```bash",
    `cd "${config.frameworkRoot}"`,
    `npm run ocb -- use ${config.projectId}`,
    "npm run ocb -- pull",
    "npm run ocb -- push",
    "```",
    "",
    "Ordinary OpenCollab collaboration should push only this task project's `opencollab/*.json` files.",
    "Do not modify or push the parent OpenCollab app unless the user explicitly asks to change the tool itself."
  ].join("\n");
  const claudeContent = [
    "# OpenCollab Claude Task Entry",
    "",
    "This is an OpenCollab task folder. Use the parent OpenCollab repo for protocol and app commands.",
    "",
    `Parent repo: \`${relativeRoot}\``,
    `Current project command: \`npm run ocb -- use ${config.projectId}\` from the parent repo.`,
    "",
    "Read the parent protocol first, then this folder's task brief and JSON status before changing project state."
  ].join("\n");
  const commandContent = [
    "# /ocb",
    "",
    "OpenCollab command bridge for this task folder.",
    "",
    `1. Read \`${relativeRoot}/opencollab/PROTOCOL_COMMANDS.md\`.`,
    `2. Read \`${config.briefFile}\`, \`${config.tinyStatusFile}\`, and \`${config.statusFile}\`.`,
    `3. Run helper commands from \`${relativeRoot}\` after selecting this project with \`npm run ocb -- use ${config.projectId}\`.`,
    "",
    `This folder is registered from the parent as \`${relativeProject}\`.`
  ].join("\n");

  const writes = [
    [path.join(config.projectRoot, "AGENTS.md"), agentContent],
    [path.join(config.projectRoot, "CLAUDE.md"), claudeContent],
    [path.join(config.projectRoot, ".claude", "commands", "ocb.md"), commandContent]
  ];
  for (const [target, content] of writes) {
    await writeTextIfMissing(target, `${content}\n`, options);
  }
  await addLocalGitExcludes(config, ["AGENTS.md", "CLAUDE.md", ".claude/commands/ocb.md"]);
}

async function addLocalGitExcludes(config, entries) {
  const excludePath = path.join(config.projectRoot, ".git", "info", "exclude");
  if (!(await exists(excludePath))) return;
  const existing = await fs.readFile(excludePath, "utf8");
  const missing = entries.filter((entry) => !existing.split(/\r?\n/).includes(entry));
  if (!missing.length) return;
  const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  await fs.writeFile(excludePath, `${existing}${prefix}${missing.join("\n")}\n`, "utf8");
}

async function updateActorDefinition(config, options) {
  if (await exists(config.statusPath)) {
    const status = normalizeStatus(JSON.parse(await fs.readFile(config.statusPath, "utf8")));
    const actorId = options.actor ?? status.workspace.currentActorId;
    const signature = options.signature ?? actorId.slice(0, 2).toUpperCase();
    const color = options.color ?? "#65b8a6";
    const displayName = options.name ?? actorId;

    const member = {
      id: actorId,
      displayName,
      signature,
      color,
      role: actorId === "agent" || actorId === "ai" ? "agent" : "human",
      active: true
    };

    status.workspace = {
      ...status.workspace,
      repo: config.repo || options.repo || status.workspace.repo,
      name: options.workspace ?? config.projectName ?? status.workspace.name,
      currentActorId: actorId,
      locked: true,
      statusFile: config.statusFile,
      updatedAt: new Date().toISOString()
    };

    const existing = status.members.findIndex((item) => item.id === actorId);
    if (existing >= 0) status.members[existing] = { ...status.members[existing], ...member };
    else status.members.push(member);

    await writeStatus(config, status);
    console.log(`Defined OpenCollab target and actor ${signature}.`);
  } else {
    console.log("Defined OpenCollab target project. Task_Status.json does not exist yet; create it during /ocb init.");
  }
}

async function writeStatus(config, status) {
  await ensureProjectDirs(config);
  await fs.writeFile(config.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function copyIfMissing(source, target, options = {}) {
  if (!options.force && (await exists(target))) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function writeJsonIfMissing(target, factory, options = {}) {
  if (!options.force && (await exists(target))) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(await factory(), null, 2)}\n`, "utf8");
}

async function writeTextIfMissing(target, content, options = {}) {
  if (!options.force && (await exists(target))) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function buildTaskStatus(config) {
  const template = JSON.parse(await fs.readFile(config.templateStatusPath, "utf8"));
  const now = new Date().toISOString();
  const metadata = taskStatusMetadata(config, template, now);
  return {
    ...template,
    ...metadata,
    workspace: {
      ...template.workspace,
      ...metadata.workspace,
      name: config.projectName,
      locked: false
    }
  };
}

async function buildTinyStatus(config) {
  const template = JSON.parse(await fs.readFile(config.templateTinyStatusPath, "utf8"));
  const now = new Date().toISOString();
  return {
    ...template,
    project: {
      ...template.project,
      name: config.projectName,
      repo: config.repo,
      statusTarget: config.statusFile,
      cloudDocument: config.source || (config.repo ? repoUrl(config.repo) : ""),
      output: `Task interface dataset for ${config.projectName}.`,
      collaborationMode:
        "OpenCollab app stays in the parent tool repo; this task folder stores the task brief and JSON collaboration state."
    },
    brief: {
      ...template.brief,
      assignment: `Read ${config.briefFile}, then expand this tiny brief into ${config.statusFile}.`
    },
    createdAt: now
  };
}

async function refreshTaskMetadata(config) {
  if (await exists(config.statusPath)) {
    const status = JSON.parse(await fs.readFile(config.statusPath, "utf8"));
    const next = {
      ...status,
      ...taskStatusMetadata(config, status, status.workspace?.updatedAt ?? new Date().toISOString())
    };
    if (JSON.stringify(next) !== JSON.stringify(status)) {
      await fs.writeFile(config.statusPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
  }
  if (await exists(config.tinyStatusPath)) {
    const tiny = JSON.parse(await fs.readFile(config.tinyStatusPath, "utf8"));
    const next = {
      ...tiny,
      project: {
        ...(tiny.project ?? {}),
        repo: config.repo,
        statusTarget: config.statusFile,
        cloudDocument: tiny.project?.cloudDocument || config.source || (config.repo ? repoUrl(config.repo) : ""),
        collaborationMode:
          "OpenCollab parent repo stays local; the task folder stores the task brief and JSON dataset."
      }
    };
    if (JSON.stringify(next) !== JSON.stringify(tiny)) {
      await fs.writeFile(config.tinyStatusPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
  }
}

function taskStatusMetadata(config, base = {}, updatedAt = new Date().toISOString()) {
  return {
    commands: {
      ...(base.commands ?? {}),
      def: "/ocb def --actor <id> --signature <text> --color <hex>",
      init: config.repo ? `/ocb init ${repoUrl(config.repo)}` : "/ocb init <github-repo-url>",
      run: "/ocb run",
      list: "/ocb list",
      use: "/ocb use <project-id>",
      pull: "/ocb pull",
      push: "/ocb push",
      mtg: "/ocb mtg --title <meeting> --task <taskId> --notes <text>"
    },
    protocol: {
      ...(base.protocol ?? {}),
      cloudDocument: base.protocol?.cloudDocument || config.source || (config.repo ? repoUrl(config.repo) : ""),
      commandProtocol: "parent:opencollab/PROTOCOL_COMMANDS.md",
      interdependenceFramework: "parent:opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md",
      promptLibrary: "parent:opencollab/PROMPTS.md",
      agentEntryFiles: ["AGENTS.md", "CLAUDE.md", ".claude/commands/ocb.md"],
      initSummary:
        "This task folder is managed by a parent OpenCollab repo. The agent should read the project brief, decompose minimal task interfaces, then maintain this JSON dataset."
    },
    taskBrief: {
      ...(base.taskBrief ?? {}),
      path: config.briefFile,
      cloudDocument: base.taskBrief?.cloudDocument || config.source || (config.repo ? repoUrl(config.repo) : ""),
      firstReadOrder: normalizeFirstReadOrder(base.taskBrief?.firstReadOrder),
      lastReviewedAt: base.taskBrief?.lastReviewedAt ?? updatedAt
    },
    workspace: {
      ...(base.workspace ?? {}),
      repo: config.repo || base.workspace?.repo || "",
      statusFile: config.statusFile,
      updatedAt
    }
  };
}

function normalizeFirstReadOrder(order) {
  const fallback = [
    "parent:AGENTS.md",
    "parent:CLAUDE.md",
    "parent:opencollab/PROTOCOL_COMMANDS.md",
    "TASK_BRIEF.md",
    "opencollab/TTask_Status.json",
    "opencollab/Task_Status.json",
    "opencollab/Task_Status.schema.json",
    "parent:opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md",
    "parent:opencollab/PROMPTS.md",
    "parent:opencollab/AGENT.md",
    "parent:README.md"
  ];
  const input = Array.isArray(order) && order.length ? order : fallback;
  return input.map((entry) =>
    String(entry)
      .replace(/^OpenCollab\//, "parent:")
      .replace(/^target:/, "")
      .replace(/^opencollab\/(PROTOCOL_COMMANDS|INTERDEPENDENCE_CONFLICT_FRAMEWORK|PROMPTS|AGENT)\.md$/, "parent:opencollab/$1.md")
      .replace(/^README\.md$/, "parent:README.md")
      .replace(/^AGENTS\.md$/, "parent:AGENTS.md")
      .replace(/^CLAUDE\.md$/, "parent:CLAUDE.md")
  );
}

async function collectJsonDataset(config) {
  const files = new Set();
  files.add(path.relative(config.projectRoot, config.statusPath).replace(/\\/g, "/"));
  files.add(path.relative(config.projectRoot, config.tinyStatusPath).replace(/\\/g, "/"));
  files.add(path.relative(config.projectRoot, config.schemaPath).replace(/\\/g, "/"));
  const dataDir = path.join(config.projectRoot, "opencollab");
  try {
    for (const entry of await fs.readdir(dataDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.add(path.posix.join("opencollab", entry.name));
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return [...files].filter(Boolean);
}

function projectSummary(config) {
  return {
    projectId: config.projectId,
    projectName: config.projectName,
    projectRoot: config.projectRoot,
    tasksDir: path.join(config.frameworkRoot, TASKS_DIR),
    repo: config.repo,
    source: config.source,
    briefFile: config.briefFile,
    briefPath: config.briefPath,
    tinyStatusFile: config.tinyStatusFile,
    tinyStatusPath: config.tinyStatusPath,
    statusFile: config.statusFile,
    statusPath: config.statusPath,
    schemaFile: config.schemaFile,
    schemaPath: config.schemaPath,
    usingFallbackStatus: config.usingFallbackStatus
  };
}

function appendPushUpdate(status) {
  const actorId = status.workspace.currentActorId || "agent";
  const activeTasks = (status.tasks ?? []).filter((task) => normalizeProgress(task.progress) > 0 || ["active", "working", "done"].includes(task.state));
  const taskIds = activeTasks.slice(0, 6).map((task) => task.id);
  const conflictCount = (status.conflicts ?? []).filter((conflict) => !conflict.resolved).length;
  const details = [
    `Reviewed ${activeTasks.length} active task interfaces before push.`,
    taskIds.length ? `Highlighted ${taskIds.join(", ")}.` : "No active task interface needed highlighting.",
    conflictCount ? `${conflictCount} boundary/conflict item(s) still need attention.` : "No unresolved conflicts are recorded."
  ].join(" ");
  status.timeline = [
    {
      id: `tl-${Date.now()}`,
      type: "update",
      actorId,
      taskIds,
      title: "Agent push review",
      details,
      createdAt: new Date().toISOString(),
      adds: ["tasks[] review", "conflicts[] review", "timeline[]"]
    },
    ...(status.timeline ?? [])
  ];
  status.workspace.updatedAt = new Date().toISOString();
}

function normalizeStatus(status) {
  const { classification, statusModel, ...statusBase } = status;
  const categories = status.categories?.length ? status.categories : [defaultCategory];
  const board = {
    cols: Math.max(1, Math.round(Number(status.view?.board?.cols) || defaultBoard.cols)),
    rows: Math.max(1, Math.round(Number(status.view?.board?.rows) || defaultBoard.rows))
  };
  const tasks = (status.tasks ?? []).map((task, index) => {
    const { dependsOn, ...taskBase } = task;
    return {
      ...taskBase,
      category: task.category || categories[0].id,
      state: normalizeState(task.state),
      progress: task.progress === undefined ? progressFromState(task.state) : normalizeProgress(task.progress),
      grid: normalizeGrid(task.grid, index, board),
      touches: task.touches ?? [],
      interfaces: {
        inputs: Array.isArray(task.interfaces?.inputs) ? task.interfaces.inputs : [],
        outputs: Array.isArray(task.interfaces?.outputs) ? task.interfaces.outputs : [],
        boundaryNotes: Array.isArray(task.interfaces?.boundaryNotes) ? task.interfaces.boundaryNotes : []
      },
      updatedAt: task.updatedAt ?? new Date().toISOString()
    };
  });
  return {
    ...statusBase,
    view: {
      ...(status.view ?? {}),
      board,
      taskIdPrefix: status.view?.taskIdPrefix || inferTaskPrefix(tasks),
      progressSteps: status.view?.progressSteps ?? 24
    },
    categories,
    tasks,
    links: status.links ?? [],
    timeline: status.timeline ?? [],
    meetings: status.meetings ?? [],
    conflicts: status.conflicts ?? []
  };
}

function normalizeState(state) {
  return state === "working" ? "active" : state || "undo";
}

function normalizeProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function progressFromState(state) {
  const normalized = normalizeState(state);
  if (normalized === "done") return 100;
  if (normalized === "active") return 60;
  return 0;
}

function normalizeGrid(grid, index, board) {
  const width = Math.max(1, Math.round(Number(grid?.w) || 1));
  const height = Math.max(1, Math.round(Number(grid?.h) || 1));
  const fallbackX = (index % board.cols) + 1;
  const fallbackY = Math.floor(index / board.cols) + 1;
  return {
    x: Math.min(Math.max(1, Math.round(Number(grid?.x) || fallbackX)), Math.max(1, board.cols - width + 1)),
    y: Math.max(1, Math.round(Number(grid?.y) || fallbackY)),
    w: width,
    h: height
  };
}

function inferTaskPrefix(tasks) {
  const counts = new Map();
  for (const task of tasks ?? []) {
    const match = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(task.id ?? "");
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OCB";
}

function recordToArgs(project) {
  return {
    id: project.id,
    name: project.name,
    projectDir: project.projectDir,
    repo: project.repo,
    source: project.source,
    statusFile: project.statusFile ?? DEFAULT_STATUS_FILE,
    tinyStatusFile: project.tinyStatusFile ?? DEFAULT_TINY_STATUS_FILE,
    schemaFile: project.schemaFile ?? DEFAULT_SCHEMA_FILE,
    brief: project.briefFile ?? DEFAULT_BRIEF_FILE
  };
}

function printHelp() {
  console.log("OpenCollab helper commands: init, run, list, use, pull, push, mtg, status, def");
  console.log("Typical first run: npm run ocb -- init https://github.com/<owner>/<task-repo>.git");
  console.log("Use /ocb inside an agent conversation; this helper performs mechanical local steps.");
}

async function printProjects() {
  const projects = await listRegisteredProjects(process.cwd());
  if (!projects.length) {
    console.log("No OpenCollab task projects registered yet.");
    console.log("Run: npm run ocb -- init https://github.com/<owner>/<task-repo>.git");
    return;
  }
  for (const project of projects) {
    const marker = project.current ? "*" : " ";
    console.log(`${marker} ${project.id}  ${project.name}  ${project.projectDir}`);
  }
}

function printConfiguredProject(config) {
  console.log(`OpenCollab project: ${config.projectName} (${config.projectId})`);
  console.log(`Task folder: ${config.projectRoot}`);
  console.log(`Status file: ${config.statusPath}`);
  console.log(`Agent workspace can switch to: ${config.projectRoot}`);
}

async function startDevServer() {
  await run("npm", ["run", "dev"], { inherit: true, cwd: process.cwd() });
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const [key, ...inlineValue] = raw.split("=");
    const camelKey = toCamel(key);
    if (inlineValue.length) {
      parsed[camelKey] = inlineValue.join("=");
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      parsed[camelKey] = argv[index + 1];
      index += 1;
    } else {
      parsed[camelKey] = "true";
    }
  }
  const positionalRepo = parseRepoInput(parsed._[0]);
  if (positionalRepo && !parsed.repo) parsed.repo = positionalRepo.canonical;
  return parsed;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function repoUrl(repo) {
  return repo?.startsWith("http") ? repo : `https://github.com/${repo}`;
}

function normalizeRelativePath(value) {
  return String(value || ".").replace(/\\/g, "/");
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function run(cmd, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" && cmd === "npm" ? "npm.cmd" : cmd;
    const child = spawn(executable, cmdArgs, {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      stdio: options.inherit ? "inherit" : "pipe"
    });
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) resolve(code);
      else reject(new Error(`${cmd} ${cmdArgs.join(" ")} failed with ${code}`));
    });
  });
}
