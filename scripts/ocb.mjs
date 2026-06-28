import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureProjectDirs, exists, resolveProjectConfig, saveProjectConfig } from "./project-config.mjs";

const defaultBoard = { cols: 14, rows: 12 };
const defaultCategory = { id: "general", label: "General", color: "#7d838f" };
const command = process.argv[2] ?? "help";
const args = Object.fromEntries(
  process.argv.slice(3).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [toCamel(key), value.join("=") || "true"];
  })
);

if (command === "help") {
  console.log("OpenCollab helper commands: def, init, run, pull, push, mtg, status");
  console.log("Use /ocb inside an agent conversation; this helper only performs mechanical local steps.");
  console.log("Target project data lives outside this framework repo by default.");
  process.exit(0);
}

if (command === "status") {
  const config = await resolveProjectConfig(args);
  console.log(JSON.stringify(projectSummary(config), null, 2));
  process.exit(0);
}

if (command === "def") {
  const config = await configureTarget(args);
  if (await exists(config.statusPath)) {
    const status = normalizeStatus(JSON.parse(await fs.readFile(config.statusPath, "utf8")));
    const actorId = args.actor ?? status.workspace.currentActorId;
    const signature = args.signature ?? actorId.slice(0, 2).toUpperCase();
    const color = args.color ?? "#29d8d0";
    const displayName = args.name ?? actorId;

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
      repo: config.repo || args.repo || status.workspace.repo,
      name: args.workspace ?? status.workspace.name,
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
    await ensureProjectDirs(config);
    console.log("Defined OpenCollab target project. Task_Status.json does not exist yet; create it during /ocb init.");
  }
  process.exit(0);
}

if (command === "init" || command === "run") {
  const config = await configureTarget(args);
  console.log(`OpenCollab target project: ${config.projectRoot}`);
  console.log(`OpenCollab status file: ${config.statusPath}`);
  await run("npm", ["run", "dev"], { inherit: true, cwd: process.cwd() });
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

async function configureTarget(options) {
  const config = await resolveProjectConfig(options);
  await ensureProjectDirs(config);
  await saveProjectConfig(config);
  return config;
}

async function writeStatus(config, status) {
  await ensureProjectDirs(config);
  await fs.writeFile(config.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function collectJsonDataset(config) {
  const files = new Set();
  files.add(path.relative(config.projectRoot, config.statusPath).replace(/\\/g, "/"));
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
    projectRoot: config.projectRoot,
    repo: config.repo,
    source: config.source,
    briefFile: config.briefFile,
    briefPath: config.briefPath,
    statusFile: config.statusFile,
    statusPath: config.statusPath,
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

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function run(cmd, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: options.cwd ?? process.cwd(),
      shell: process.platform === "win32",
      stdio: options.inherit ? "inherit" : "pipe"
    });
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) resolve(code);
      else reject(new Error(`${cmd} ${cmdArgs.join(" ")} failed with ${code}`));
    });
  });
}
