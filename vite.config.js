import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { defineConfig } from "vite";

const execFileAsync = promisify(execFile);
const statusPath = path.resolve("opencollab", "Task_Status.json");
const defaultBoard = { cols: 14, rows: 12 };
const defaultCategory = { id: "general", label: "General", color: "#7d838f" };

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
  const raw = await fs.readFile(statusPath, "utf8");
  return normalizeStatus(JSON.parse(raw));
}

async function writeStatus(status) {
  const normalized = normalizeStatus(status);
  const next = {
    ...normalized,
    workspace: {
      ...normalized.workspace,
      updatedAt: new Date().toISOString()
    },
    conflicts: analyzeConflicts(normalized)
  };
  await fs.writeFile(statusPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
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

async function runGit(args) {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    timeout: 30000
  });
  return { stdout, stderr };
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
            json(res, 200, await readStatus());
            return;
          }

          if (req.method === "PUT" && url.pathname === "/api/status") {
            const body = await readBody(req);
            const saved = await writeStatus(body.status ?? body);
            json(res, 200, { ok: true, status: saved });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/git/pull") {
            const result = await runGit(["pull", "--ff-only"]);
            json(res, 200, { ok: true, result, status: await readStatus() });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/git/push") {
            const body = await readBody(req);
            const draft = body.status ?? (await readStatus());
            const current = await writeStatus(appendPushUpdate(draft));
            await runGit(["add", "opencollab/Task_Status.json", "opencollab/AGENT.md", "opencollab/Task_Status.schema.json"]);
            const diff = await runGit(["diff", "--cached", "--quiet"]).catch((error) => error);
            let commit = { stdout: "", stderr: "No staged changes to commit." };
            if (diff?.code === 1) {
              commit = await runGit(["commit", "-m", "Update OpenCollab task status"]);
            }
            const push = await runGit(["push"]);
            json(res, 200, { ok: true, status: current, commit, push });
            return;
          }

          json(res, 404, { ok: false, error: "Unknown OpenCollab API route" });
        } catch (error) {
          json(res, 500, {
            ok: false,
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr
          });
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
