import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defineConfig } from "vite";
import {
  TASKS_DIR,
  ensureProjectDirs,
  findRegisteredProject,
  listRegisteredProjects,
  resolveProjectConfig,
  saveProjectConfig
} from "./scripts/project-config.mjs";

const execFileAsync = promisify(execFile);
const defaultBoard = { cols: 14, rows: 12 };
const defaultCategory = { id: "general", label: "General", color: "#7d838f" };
const semanticTaskFields = [
  "title",
  "category",
  "state",
  "claimantId",
  "ownerId",
  "progress",
  "grid",
  "summary",
  "touches",
  "interfaces"
];

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readStatus() {
  const config = await resolveProjectConfig();
  const readableStatusPath = config.usingFallbackStatus ? config.fallbackStatusPath : config.statusPath;
  const raw = await fs.readFile(readableStatusPath, "utf8");
  return { status: normalizeStatus(JSON.parse(raw)), meta: projectMeta(config) };
}

async function writeStatus(status) {
  const config = await resolveProjectConfig();
  return writeStatusForConfig(config, status);
}

async function writeStatusForConfig(config, status) {
  if (config.usingFallbackStatus && !config.hasLocalConfig) {
    throw new Error("No target project is configured. Run npm run ocb -- init <github-repo-url> first.");
  }
  await ensureProjectDirs(config);
  const normalized = normalizeStatus(status);
  const next = {
    ...normalized,
    workspace: {
      ...normalized.workspace,
      repo: config.repo || normalized.workspace?.repo || "",
      statusFile: config.statusFile,
      updatedAt: new Date().toISOString()
    },
    conflicts: analyzeConflicts(normalized)
  };
  await fs.writeFile(config.statusPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { status: next, meta: projectMeta(config) };
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
  const width = 1;
  const height = 1;
  const fallbackX = (index % board.cols) + 1;
  const fallbackY = Math.floor(index / board.cols) + 1;
  return {
    x: Math.min(Math.max(1, Math.round(Number(grid?.x) || fallbackX)), board.cols),
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

function taskOwner(task) {
  return task.claimantId || task.ownerId || "";
}

function activeTask(task) {
  return normalizeProgress(task.progress) > 0 || ["active", "working", "done"].includes(task.state);
}

function analyzeConflicts(status) {
  const tasks = status.tasks ?? [];
  const members = new Map((status.members ?? []).map((member) => [member.id, member]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const conflicts = [];
  const now = new Date().toISOString();

  for (const link of status.links ?? []) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;
    const sourceOwner = taskOwner(source);
    const targetOwner = taskOwner(target);
    const differentOwners = sourceOwner && targetOwner && sourceOwner !== targetOwner;
    const bothActive = activeTask(source) && activeTask(target);
    if ((link.kind === "boundary" || link.kind === "sync") && differentOwners && bothActive) {
      conflicts.push({
        id: `boundary-${link.source}-${link.target}`,
        type: "boundary-sync",
        severity: normalizeProgress(source.progress) >= 100 && normalizeProgress(target.progress) >= 100 ? "high" : "medium",
        taskIds: [source.id, target.id],
        memberIds: [sourceOwner, targetOwner],
        title: "Boundary sync needed",
        message: `${source.id} and ${target.id} are active across a ${link.kind} edge. ${members.get(sourceOwner)?.signature ?? sourceOwner} and ${members.get(targetOwner)?.signature ?? targetOwner} should sync before push.`,
        detectedAt: now,
        resolved: false
      });
    }
  }

  const fileMap = new Map();
  for (const task of tasks) {
    if (!activeTask(task)) continue;
    for (const file of task.touches ?? []) {
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file).push(task);
    }
  }

  for (const [file, touchingTasks] of fileMap) {
    const owners = new Set(touchingTasks.map(taskOwner).filter(Boolean));
    if (touchingTasks.length > 1 && owners.size > 1) {
      conflicts.push({
        id: `shared-${file.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
        type: "shared-file",
        severity: "medium",
        taskIds: touchingTasks.map((task) => task.id),
        memberIds: [...owners],
        title: "Shared file boundary",
        message: `${file} is touched by ${touchingTasks.map((task) => task.id).join(", ")}. Confirm ownership before push.`,
        detectedAt: now,
        resolved: false
      });
    }
  }

  for (const link of status.links ?? []) {
    if (link.kind !== "dependency") continue;
    const prerequisite = byId.get(link.source);
    const downstream = byId.get(link.target);
    if (prerequisite && downstream && normalizeProgress(downstream.progress) >= 100 && normalizeProgress(prerequisite.progress) < 100) {
      conflicts.push({
        id: `blocked-${downstream.id}-${prerequisite.id}`,
        type: "dependency-not-done",
        severity: "high",
        taskIds: [downstream.id, prerequisite.id],
        memberIds: [taskOwner(downstream), taskOwner(prerequisite)].filter(Boolean),
        title: "Done task has unfinished dependency",
        message: `${downstream.id} is done but depends on ${prerequisite.id}, which is ${normalizeProgress(prerequisite.progress)}%.`,
        detectedAt: now,
        resolved: false
      });
    }
  }

  return conflicts;
}

function appendPushUpdate(status) {
  const conflicts = analyzeConflicts(status);
  const actorId = status.workspace?.currentActorId || "agent";
  const activeTasks = (status.tasks ?? []).filter((task) => activeTask(task));
  const taskIds = activeTasks.slice(0, 6).map((task) => task.id);
  const conflictCount = conflicts.filter((conflict) => !conflict.resolved).length;
  const details = [
    `Reviewed ${activeTasks.length} active task interfaces before push.`,
    taskIds.length ? `Highlighted ${taskIds.join(", ")}.` : "No active task interface needed highlighting.",
    conflictCount ? `${conflictCount} boundary/conflict item(s) still need attention.` : "No unresolved conflicts are recorded."
  ].join(" ");

  return {
    ...status,
    conflicts,
    timeline: [
      {
        id: `tl-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        type: "update",
        actorId,
        taskIds,
        title: "Agent push review",
        details,
        createdAt: new Date().toISOString(),
        adds: ["tasks[] review", "conflicts[] review", "timeline[]"]
      },
      ...(status.timeline ?? [])
    ]
  };
}

async function runGit(args, config) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: config.projectRoot,
      timeout: 30000
    });
    return { stdout, stderr };
  } catch (error) {
    error.gitArgs = args;
    throw error;
  }
}

function projectMeta(config) {
  return {
    projectId: config.projectId,
    projectName: config.projectName,
    projectRoot: config.projectRoot,
    tasksDir: path.join(config.frameworkRoot, TASKS_DIR),
    repo: config.repo,
    source: config.source,
    tinyStatusFile: config.tinyStatusFile,
    tinyStatusPath: config.tinyStatusPath,
    schemaFile: config.schemaFile,
    schemaPath: config.schemaPath,
    statusFile: config.statusFile,
    statusPath: config.statusPath,
    briefFile: config.briefFile,
    briefPath: config.briefPath,
    usingFallbackStatus: config.usingFallbackStatus,
    hasLocalConfig: config.hasLocalConfig
  };
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

async function trackedLocalChanges(config) {
  const { stdout } = await runGit(["status", "--porcelain"], config);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.startsWith("??"))
    .map((line) => ({
      status: line.slice(0, 2),
      file: line.slice(3).trim()
    }));
}

async function branchDivergence(config) {
  await runGit(["fetch"], config);
  const { stdout } = await runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"], config);
  const [ahead = 0, behind = 0] = stdout
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  return { ahead, behind };
}

async function upstreamInfo(config) {
  const fallback = { remote: "origin", branch: "main", remoteRef: "origin/main", pushRef: "refs/heads/main" };
  const result = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], config).catch(() => null);
  const remoteRef = result?.stdout?.trim() || fallback.remoteRef;
  const [remote = fallback.remote, ...branchParts] = remoteRef.split("/");
  const branch = branchParts.join("/") || fallback.branch;
  return {
    remote,
    branch,
    remoteRef,
    pushRef: `refs/heads/${branch}`
  };
}

async function mergeBaseRef(config) {
  const result = await runGit(["merge-base", "HEAD", "@{u}"], config).catch(() => null);
  return result?.stdout?.trim() || "HEAD";
}

async function readStatusAtRef(config, ref) {
  const statusFile = projectRelativeFile(config, config.statusPath, config.statusFile);
  const { stdout } = await runGit(["show", `${ref}:${posixPath(statusFile)}`], config);
  return normalizeStatus(JSON.parse(stdout));
}

async function commitStatusDataset(config, status, message) {
  const current = await writeStatusForConfig(config, status);
  const files = await collectJsonDataset(config);
  if (files.length) await runGit(["add", ...files], config);
  const diff = await runGit(["diff", "--cached", "--quiet"], config).catch((error) => error);
  const merging = await hasMergeHead(config);
  let commit = { stdout: "", stderr: "No staged changes to commit." };
  if (diff?.code === 1 || merging) {
    commit = await runGit(["commit", "-m", message], config);
  }
  return { current, files, commit };
}

async function hasMergeHead(config) {
  const result = await runGit(["rev-parse", "-q", "--verify", "MERGE_HEAD"], config).catch(() => null);
  return Boolean(result?.stdout?.trim());
}

async function directPush(config, localStatus, upstream) {
  const prepared = await commitStatusDataset(config, localStatus, "Update OpenCollab task status dataset");
  const push = await runGit(["push", upstream.remote, `HEAD:${upstream.pushRef}`], config);
  return {
    ok: true,
    mode: "direct",
    status: prepared.current.status,
    meta: prepared.current.meta,
    commit: prepared.commit,
    push,
    files: prepared.files,
    branch: upstream.branch
  };
}

async function smartPush(config, localStatus, divergence, upstream) {
  const baseRef = divergence.ahead > 0 ? await mergeBaseRef(config) : "HEAD";
  const [baseStatus, remoteStatus] = await Promise.all([
    readStatusAtRef(config, baseRef),
    readStatusAtRef(config, upstream.remoteRef)
  ]);
  const semanticMerge = mergeStatuses(baseStatus, localStatus, remoteStatus);

  if (semanticMerge.conflicts.length) {
    const proposal = await pushProposalBranch(config, localStatus, semanticMerge.conflicts, upstream);
    const current = await writeStatusForConfig(config, localStatus);
    return {
      ok: true,
      mode: "proposal",
      status: current.status,
      meta: current.meta,
      proposalBranch: proposal.branch,
      proposalPush: proposal.push,
      semanticConflicts: semanticMerge.conflicts,
      divergence,
      details:
        "Smart Push found overlapping task-interface changes, so main was left unchanged and this version was saved on a proposal branch."
    };
  }

  const prepared = await commitStatusDataset(config, localStatus, "Update OpenCollab task status dataset");
  const localHead = (await runGit(["rev-parse", "HEAD"], config)).stdout.trim();
  const mergeResult = await pushMergedStatusFromWorktree(
    config,
    localHead,
    semanticMerge.status,
    upstream,
    "Smart merge OpenCollab task status"
  );
  await runGit(["fetch", upstream.remote], config);
  await runGit(["merge", "--ff-only", upstream.remoteRef], config);
  const { status, meta } = await readStatus();
  return {
    ok: true,
    mode: "smart-merge",
    status,
    meta,
    localCommit: prepared.commit,
    mergeCommit: mergeResult.commit,
    push: mergeResult.push,
    files: prepared.files,
    branch: upstream.branch,
    divergence,
    mergeSummary: semanticMerge.summary
  };
}

async function pushMergedStatusFromWorktree(config, localHead, mergedStatus, upstream, message) {
  return withDetachedWorktree(config, localHead, async (worktreeConfig) => {
    await runGit(["merge", "--no-ff", "--no-commit", "-X", "ours", upstream.remoteRef], worktreeConfig);
    const prepared = await commitStatusDataset(worktreeConfig, mergedStatus, message);
    const push = await runGit(["push", upstream.remote, `HEAD:${upstream.pushRef}`], worktreeConfig);
    return { commit: prepared.commit, push };
  });
}

async function pushProposalBranch(config, localStatus, semanticConflicts, upstream) {
  const actor = branchSafe(localStatus.workspace?.currentActorId || "agent");
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(16).slice(2, 6);
  const branch = `ocb/proposal/${actor}/${stamp}-${suffix}`;
  return withDetachedWorktree(config, upstream.remoteRef, async (worktreeConfig) => {
    const prepared = await commitStatusDataset(
      worktreeConfig,
      {
        ...localStatus,
        conflicts: [...(localStatus.conflicts ?? []), ...semanticConflicts]
      },
      "Propose OpenCollab task status update"
    );
    const push = await runGit(["push", upstream.remote, `HEAD:refs/heads/${branch}`], worktreeConfig);
    return { branch, commit: prepared.commit, push };
  });
}

async function withDetachedWorktree(config, ref, callback) {
  const tempParent = await fs.mkdtemp(path.join(os.tmpdir(), "opencollab-smartpush-"));
  const tempRoot = path.join(tempParent, "worktree");
  await runGit(["worktree", "add", "--detach", tempRoot, ref], config);
  const worktreeConfig = configForProjectRoot(config, tempRoot);
  try {
    return await callback(worktreeConfig, tempRoot);
  } finally {
    await runGit(["worktree", "remove", "--force", tempRoot], config).catch(() => null);
    await fs.rm(tempParent, { recursive: true, force: true }).catch(() => null);
  }
}

function configForProjectRoot(config, projectRoot) {
  const statusFile = projectRelativeFile(config, config.statusPath, config.statusFile);
  const tinyStatusFile = projectRelativeFile(config, config.tinyStatusPath, config.tinyStatusFile);
  const schemaFile = projectRelativeFile(config, config.schemaPath, config.schemaFile);
  const briefFile = projectRelativeFile(config, config.briefPath, config.briefFile);
  return {
    ...config,
    projectRoot,
    projectDir: projectRoot,
    statusFile,
    statusPath: path.join(projectRoot, statusFile),
    tinyStatusFile,
    tinyStatusPath: path.join(projectRoot, tinyStatusFile),
    schemaFile,
    schemaPath: path.join(projectRoot, schemaFile),
    briefFile,
    briefPath: path.join(projectRoot, briefFile)
  };
}

function projectRelativeFile(config, absolutePath, configuredPath) {
  if (!path.isAbsolute(configuredPath)) return posixPath(configuredPath);
  const relative = path.relative(config.projectRoot, absolutePath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return posixPath(relative);
  return posixPath(configuredPath);
}

function mergeStatuses(baseStatus, localStatus, remoteStatus) {
  const semanticConflicts = [];
  const taskMerge = mergeTasks(baseStatus.tasks ?? [], localStatus.tasks ?? [], remoteStatus.tasks ?? [], semanticConflicts);
  const linkMerge = mergeEntityList("link", baseStatus.links ?? [], localStatus.links ?? [], remoteStatus.links ?? [], semanticConflicts);
  const memberMerge = mergeEntityList(
    "member",
    baseStatus.members ?? [],
    localStatus.members ?? [],
    remoteStatus.members ?? [],
    semanticConflicts
  );
  const categoryMerge = mergeEntityList(
    "category",
    baseStatus.categories ?? [],
    localStatus.categories ?? [],
    remoteStatus.categories ?? [],
    semanticConflicts
  );
  const meetingMerge = mergeAppendOnlyList(
    "meeting",
    baseStatus.meetings ?? [],
    localStatus.meetings ?? [],
    remoteStatus.meetings ?? [],
    semanticConflicts
  );
  const timelineMerge = mergeAppendOnlyList(
    "timeline",
    baseStatus.timeline ?? [],
    localStatus.timeline ?? [],
    remoteStatus.timeline ?? [],
    semanticConflicts
  );

  const mergedBase = {
    ...remoteStatus,
    workspace: mergePlainObjectField("workspace", baseStatus.workspace, localStatus.workspace, remoteStatus.workspace, semanticConflicts),
    commands: mergePlainObjectField("commands", baseStatus.commands, localStatus.commands, remoteStatus.commands, semanticConflicts),
    protocol: mergePlainObjectField("protocol", baseStatus.protocol, localStatus.protocol, remoteStatus.protocol, semanticConflicts),
    taskBrief: mergePlainObjectField("taskBrief", baseStatus.taskBrief, localStatus.taskBrief, remoteStatus.taskBrief, semanticConflicts),
    view: mergePlainObjectField("view", baseStatus.view, localStatus.view, remoteStatus.view, semanticConflicts),
    categories: categoryMerge.items,
    members: memberMerge.items,
    tasks: taskMerge.items,
    links: linkMerge.items,
    meetings: meetingMerge.items,
    timeline: timelineMerge.items
  };
  const normalized = normalizeStatus({
    ...mergedBase,
    workspace: {
      ...(mergedBase.workspace ?? {}),
      currentActorId: localStatus.workspace?.currentActorId ?? mergedBase.workspace?.currentActorId,
      updatedAt: new Date().toISOString()
    }
  });
  normalized.conflicts = analyzeConflicts(normalized);
  return {
    status: normalized,
    conflicts: semanticConflicts,
    summary: {
      localTaskChanges: taskMerge.localChanges,
      remoteTaskChanges: taskMerge.remoteChanges,
      mergedTasks: taskMerge.items.length,
      mergedLinks: linkMerge.items.length,
      mergedMeetings: meetingMerge.items.length
    }
  };
}

function mergeTasks(baseList, localList, remoteList, semanticConflicts) {
  const base = entityMap(baseList);
  const local = entityMap(localList);
  const remote = entityMap(remoteList);
  const ids = orderedIds(remoteList, localList, baseList);
  const items = [];
  let localChanges = 0;
  let remoteChanges = 0;

  for (const id of ids) {
    const baseTask = base.get(id);
    const localTask = local.get(id);
    const remoteTask = remote.get(id);

    if (!baseTask) {
      if (localTask && remoteTask && !semanticEqual(localTask, remoteTask, ["updatedAt"])) {
        semanticConflicts.push(makeSemanticConflict("task", id, ["created"], localTask, remoteTask));
        items.push(remoteTask);
      } else if (localTask || remoteTask) {
        items.push(localTask ?? remoteTask);
        if (localTask) localChanges += 1;
        if (remoteTask) remoteChanges += 1;
      }
      continue;
    }

    if (!localTask && !remoteTask) continue;
    if (!localTask) {
      if (entityChanged(baseTask, remoteTask, semanticTaskFields)) {
        semanticConflicts.push(makeSemanticConflict("task", id, ["deleted locally", "changed remotely"], baseTask, remoteTask));
        items.push(remoteTask);
        remoteChanges += 1;
      }
      continue;
    }
    if (!remoteTask) {
      if (entityChanged(baseTask, localTask, semanticTaskFields)) {
        semanticConflicts.push(makeSemanticConflict("task", id, ["changed locally", "deleted remotely"], localTask, baseTask));
        items.push(localTask);
        localChanges += 1;
      }
      continue;
    }

    const localFields = changedFields(baseTask, localTask, semanticTaskFields);
    const remoteFields = changedFields(baseTask, remoteTask, semanticTaskFields);
    if (localFields.length) localChanges += 1;
    if (remoteFields.length) remoteChanges += 1;
    const overlapping = localFields.filter(
      (field) => remoteFields.includes(field) && !semanticEqual(localTask[field], remoteTask[field])
    );
    if (overlapping.length) {
      semanticConflicts.push(makeSemanticConflict("task", id, overlapping, localTask, remoteTask));
      items.push(remoteTask);
      continue;
    }

    const merged = { ...remoteTask };
    for (const field of localFields) merged[field] = localTask[field];
    merged.updatedAt = latestIso(localTask.updatedAt, remoteTask.updatedAt, baseTask.updatedAt);
    items.push(merged);
  }

  return { items, localChanges, remoteChanges };
}

function mergeEntityList(type, baseList, localList, remoteList, semanticConflicts) {
  const base = entityMap(baseList);
  const local = entityMap(localList);
  const remote = entityMap(remoteList);
  const ids = orderedIds(remoteList, localList, baseList);
  const items = [];

  for (const id of ids) {
    const baseItem = base.get(id);
    const localItem = local.get(id);
    const remoteItem = remote.get(id);

    if (!baseItem) {
      if (localItem && remoteItem && !semanticEqual(localItem, remoteItem, ["updatedAt"])) {
        semanticConflicts.push(makeSemanticConflict(type, id, ["created"], localItem, remoteItem));
        items.push(remoteItem);
      } else if (localItem || remoteItem) {
        items.push(localItem ?? remoteItem);
      }
      continue;
    }

    const localChanged = localItem ? !semanticEqual(baseItem, localItem, ["updatedAt"]) : !semanticEqual(baseItem, null);
    const remoteChanged = remoteItem ? !semanticEqual(baseItem, remoteItem, ["updatedAt"]) : !semanticEqual(baseItem, null);
    if (!localItem && !remoteItem) continue;
    if (localChanged && remoteChanged && !semanticEqual(localItem, remoteItem, ["updatedAt"])) {
      semanticConflicts.push(makeSemanticConflict(type, id, ["updated"], localItem, remoteItem));
      if (remoteItem) items.push(remoteItem);
      continue;
    }
    if (localChanged) {
      if (localItem) items.push(localItem);
      continue;
    }
    if (remoteItem) items.push(remoteItem);
  }

  return { items };
}

function mergeAppendOnlyList(type, baseList, localList, remoteList, semanticConflicts) {
  const base = entityMap(baseList);
  const remote = entityMap(remoteList);
  const local = entityMap(localList);
  const merged = new Map();

  for (const item of remoteList) if (item?.id) merged.set(item.id, item);
  for (const item of localList) {
    if (!item?.id) continue;
    const remoteItem = remote.get(item.id);
    const baseItem = base.get(item.id);
    if (
      remoteItem &&
      baseItem &&
      !semanticEqual(baseItem, item, ["updatedAt"]) &&
      !semanticEqual(baseItem, remoteItem, ["updatedAt"]) &&
      !semanticEqual(item, remoteItem, ["updatedAt"])
    ) {
      semanticConflicts.push(makeSemanticConflict(type, item.id, ["updated"], item, remoteItem));
      continue;
    }
    if (!remoteItem || !semanticEqual(item, remoteItem, ["updatedAt"])) merged.set(item.id, item);
  }

  const items = [...merged.values()].sort((a, b) => {
    const left = Date.parse(a.createdAt ?? a.updatedAt ?? "");
    const right = Date.parse(b.createdAt ?? b.updatedAt ?? "");
    if (Number.isFinite(left) && Number.isFinite(right)) return right - left;
    return 0;
  });
  return { items };
}

function mergePlainObjectField(type, baseValue, localValue, remoteValue, semanticConflicts) {
  const localChanged = !semanticEqual(baseValue ?? null, localValue ?? null, ["updatedAt"]);
  const remoteChanged = !semanticEqual(baseValue ?? null, remoteValue ?? null, ["updatedAt"]);
  if (localChanged && remoteChanged && !semanticEqual(localValue ?? null, remoteValue ?? null, ["updatedAt"])) {
    semanticConflicts.push(makeSemanticConflict(type, type, ["updated"], localValue, remoteValue));
    return remoteValue ?? localValue ?? baseValue;
  }
  if (localChanged) return localValue ?? remoteValue ?? baseValue;
  return remoteValue ?? localValue ?? baseValue;
}

function changedFields(baseItem, nextItem, fields) {
  return fields.filter((field) => !semanticEqual(baseItem?.[field], nextItem?.[field]));
}

function entityChanged(baseItem, nextItem, fields) {
  return changedFields(baseItem, nextItem, fields).length > 0;
}

function entityMap(items) {
  const map = new Map();
  for (const item of items ?? []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function orderedIds(...lists) {
  const ids = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of list ?? []) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      ids.push(item.id);
    }
  }
  return ids;
}

function makeSemanticConflict(type, id, fields, localValue, remoteValue) {
  const taskIds = type === "task" ? [id] : [...new Set([...(localValue?.taskIds ?? []), ...(remoteValue?.taskIds ?? [])])];
  return {
    id: `smart-${type}-${branchSafe(id)}-${fields.map(branchSafe).join("-")}`,
    type: "smart-push-conflict",
    severity: "high",
    taskIds,
    title: "Smart Push conflict",
    message: `${type} ${id} has overlapping ${fields.join(", ")} change(s). Main was not changed; review the proposal branch.`,
    detectedAt: new Date().toISOString(),
    resolved: false
  };
}

function semanticEqual(left, right, ignoreKeys = []) {
  return JSON.stringify(canonicalValue(left, new Set(ignoreKeys))) === JSON.stringify(canonicalValue(right, new Set(ignoreKeys)));
}

function canonicalValue(value, ignoreKeys) {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, ignoreKeys));
  if (!value || typeof value !== "object") return value === undefined ? null : value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !ignoreKeys.has(key))
      .sort()
      .map((key) => [key, canonicalValue(value[key], ignoreKeys)])
  );
}

function latestIso(...values) {
  const parsed = values
    .map((value) => Date.parse(value ?? ""))
    .filter((value) => Number.isFinite(value));
  if (!parsed.length) return new Date().toISOString();
  return new Date(Math.max(...parsed)).toISOString();
}

function branchSafe(value) {
  return String(value ?? "item")
    .trim()
    .replace(/[^a-z0-9._/-]+/gi, "-")
    .replace(/\/+/g, "/")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 80) || "item";
}

function posixPath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function localChangesPullPayload(config, changes, divergence = {}) {
  const files = changes.map((change) => change.file);
  return {
    ok: false,
    code: "LOCAL_CHANGES_BLOCK_PULL",
    error: "Pull stopped because this task folder has local changes.",
    details:
      "Git refused to pull because remote updates may overwrite local files in this workspace. Decide whether these local JSON changes should be published or discarded before pulling again.",
    files,
    divergence,
    nextSteps: [
      "If these changes are real work: click Sync, then Push JSON, then Pull JSON again.",
      "If this workspace should only receive the latest remote state: discard or stash the listed local files, then Pull JSON again.",
      `Task folder: ${config.projectRoot}`
    ]
  };
}

function divergedBranchPayload(config, divergence, action) {
  return {
    ok: false,
    code: "BRANCH_DIVERGED",
    error: `${action} stopped because this task folder and GitHub both have different commits.`,
    details:
      "This happens when two local OpenCollab workspaces push or commit against the same task repo before one of them has pulled the other's update. A fast-forward pull cannot combine those histories.",
    divergence,
    nextSteps: [
      "If this workspace has work you want to keep: open the task folder in Git and run git pull --rebase, resolve any JSON conflict, then push again.",
      "If this workspace is only a test copy: discard/reset this task folder to origin/main, then pull again.",
      `Task folder: ${config.projectRoot}`
    ]
  };
}

function remoteAheadPushPayload(config, divergence) {
  return {
    ok: false,
    code: "REMOTE_AHEAD_BLOCK_PUSH",
    error: "Push stopped because GitHub already has newer task JSON updates.",
    details:
      "Another workspace pushed to this task repo first. Pull the remote update before publishing from this workspace, otherwise your push would overwrite or fork the task history.",
    divergence,
    nextSteps: [
      "Click Pull JSON if this workspace has no local task edits.",
      "If Pull JSON says branches diverged, keep both versions by rebasing/merging in the task folder, or reset this test workspace to origin/main.",
      `Task folder: ${config.projectRoot}`
    ]
  };
}

function isNonFastForwardError(error) {
  const text = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n");
  return /non-fast-forward|failed to push some refs|tip of your current branch is behind/i.test(text);
}

function gitFailurePayload(error) {
  const text = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n");
  if (isNonFastForwardError(error)) {
    return {
      ok: false,
      code: "PUSH_REJECTED_NON_FAST_FORWARD",
      error: "Push rejected because GitHub has newer commits.",
      details:
        "Another workspace pushed first. This workspace must integrate the remote update before it can push.",
      nextSteps: [
        "Try Pull JSON first.",
        "If Pull JSON reports diverging branches, run git pull --rebase in the task folder and resolve the JSON conflict, or reset this test workspace to origin/main."
      ],
      stderr: error.stderr,
      stdout: error.stdout
    };
  }
  if (/Diverging branches|Not possible to fast-forward|fatal: Not possible to fast-forward/i.test(text)) {
    return {
      ok: false,
      code: "PULL_REJECTED_DIVERGED",
      error: "Pull stopped because the local and remote branches diverged.",
      details:
        "Both this workspace and GitHub have commits the other side does not have. Fast-forward pull cannot combine them.",
      nextSteps: [
        "Keep both: run git pull --rebase in the task folder, resolve JSON conflicts, then Push JSON.",
        "Discard this test copy: reset the task folder to origin/main, then Pull JSON again."
      ],
      stderr: error.stderr,
      stdout: error.stdout
    };
  }
  if (/Your local changes.*would be overwritten|Please commit your changes or stash them/i.test(text)) {
    return {
      ok: false,
      code: "LOCAL_CHANGES_BLOCK_PULL",
      error: "Pull stopped because local files would be overwritten.",
      details: "Commit, push, stash, or discard the local task JSON changes before pulling.",
      stderr: error.stderr,
      stdout: error.stdout
    };
  }
  return {
    ok: false,
    code: "GIT_COMMAND_FAILED",
    error: error.message,
    stderr: error.stderr,
    stdout: error.stdout
  };
}

function localApiPlugin() {
  return {
    name: "opencollab-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }

        try {
          const url = new URL(req.url, "http://localhost");

          if (req.method === "GET" && url.pathname === "/api/status") {
            const { status, meta } = await readStatus();
            json(res, 200, { status, meta });
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/project") {
            const config = await resolveProjectConfig();
            json(res, 200, { ok: true, meta: projectMeta(config) });
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/projects") {
            const config = await resolveProjectConfig();
            const projects = await listRegisteredProjects(config.frameworkRoot);
            json(res, 200, { ok: true, current: config.projectId, projects });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/project/use") {
            const body = await readBody(req);
            const config = await resolveProjectConfig();
            const project = await findRegisteredProject(body.projectId ?? body.id ?? body.project, config.frameworkRoot);
            if (!project) {
              json(res, 404, { ok: false, error: "OpenCollab project not found" });
              return;
            }
            const nextConfig = await resolveProjectConfig(
              {
                id: project.id,
                name: project.name,
                projectDir: project.projectDir,
                repo: project.repo,
                source: project.source,
                statusFile: project.statusFile,
                tinyStatusFile: project.tinyStatusFile,
                schemaFile: project.schemaFile,
                brief: project.briefFile
              },
              { frameworkRoot: config.frameworkRoot }
            );
            await saveProjectConfig(nextConfig);
            const { status, meta } = await readStatus();
            json(res, 200, { ok: true, status, meta });
            return;
          }

          if (req.method === "PUT" && url.pathname === "/api/status") {
            const body = await readBody(req);
            const saved = await writeStatus(body.status ?? body);
            json(res, 200, { ok: true, status: saved.status, meta: saved.meta });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/git/pull") {
            const config = await resolveProjectConfig();
            const divergence = await branchDivergence(config);
            if (divergence.ahead > 0 && divergence.behind > 0) {
              json(res, 409, divergedBranchPayload(config, divergence, "Pull"));
              return;
            }
            const localChanges = await trackedLocalChanges(config);
            if (localChanges.length) {
              json(res, 409, localChangesPullPayload(config, localChanges, divergence));
              return;
            }
            const result = await runGit(["pull", "--ff-only"], config);
            const { status, meta } = await readStatus();
            json(res, 200, { ok: true, result, status, meta });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/git/push") {
            const config = await resolveProjectConfig();
            const body = await readBody(req);
            const currentRead = await readStatus();
            const draft = body.status ?? currentRead.status;
            const localStatus = normalizeStatus(appendPushUpdate(draft));
            const divergence = await branchDivergence(config);
            const upstream = await upstreamInfo(config);
            let result;
            if (divergence.behind > 0) {
              result = await smartPush(config, localStatus, divergence, upstream);
            } else {
              try {
                result = await directPush(config, localStatus, upstream);
              } catch (error) {
                if (!isNonFastForwardError(error)) throw error;
                const latestDivergence = await branchDivergence(config);
                result = await smartPush(config, localStatus, latestDivergence, upstream);
              }
            }
            json(res, 200, result);
            return;
          }

          json(res, 404, { ok: false, error: "Unknown OpenCollab API route" });
        } catch (error) {
          const payload = error.gitArgs ? gitFailurePayload(error) : {
            ok: false,
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr
          };
          json(res, payload.code ? 409 : 500, payload);
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    port: 5173
  }
});
