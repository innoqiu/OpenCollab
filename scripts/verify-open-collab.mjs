import fs from "node:fs";

const allowedStates = new Set(["undo", "claimed", "active", "done"]);
const statusPath = process.env.OCB_VERIFY_STATUS ?? "opencollab/templates/Task_Status.template.json";

const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
const schema = JSON.parse(fs.readFileSync("opencollab/Task_Status.schema.json", "utf8"));
const app = fs.readFileSync("src/App.jsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const agent = fs.readFileSync("opencollab/AGENT.md", "utf8");
const framework = fs.readFileSync("opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md", "utf8");
const prompts = fs.readFileSync("opencollab/PROMPTS.md", "utf8");
const protocol = fs.readFileSync("opencollab/PROTOCOL_COMMANDS.md", "utf8");
const projectConfig = fs.readFileSync("scripts/project-config.mjs", "utf8");
const ocb = fs.readFileSync("scripts/ocb.mjs", "utf8");
const viteConfig = fs.readFileSync("vite.config.js", "utf8");
const board = status.view?.board ?? { cols: 14, rows: 12 };

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(Boolean(status.view?.board?.cols && status.view?.board?.rows), "status.view.board is missing");
assert(Boolean(status.view?.taskIdPrefix), "status.view.taskIdPrefix is missing");
assert(Number.isInteger(status.view?.progressSteps), "status.view.progressSteps is missing");
assert(!("statusModel" in status), "statusModel is redundant and should not be persisted");
assert(!("classification" in status), "classification is redundant; categories[] and links[] should drive the view");
assert(Boolean(status.workspace?.name), "workspace.name is missing");
assert(Boolean(status.workspace?.statusFile), "workspace.statusFile is missing");
assert(Boolean(status.commands?.init), "commands.init is missing");
assert(Boolean(status.protocol?.commandProtocol), "protocol.commandProtocol is missing");

for (const task of status.tasks ?? []) {
  assert(allowedStates.has(task.state), `${task.id} has unsupported state ${task.state}`);
  assert(Number.isInteger(task.progress) && task.progress >= 0 && task.progress <= 100, `${task.id} has invalid progress`);
  assert(!("dependsOn" in task), `${task.id} still has redundant dependsOn; dependency links should be in links[]`);
  assert(task.grid.w === 1 && task.grid.h === 1, `${task.id} should render as a single matrix cell`);
  assert(task.grid.x >= 1 && task.grid.y >= 1, `${task.id} grid starts outside board`);
  assert(task.grid.x + task.grid.w - 1 <= board.cols, `${task.id} grid exceeds board columns`);
  assert(task.grid.y + task.grid.h - 1 <= board.rows, `${task.id} grid exceeds board rows`);
}

for (const [index, first] of (status.tasks ?? []).entries()) {
  for (const second of (status.tasks ?? []).slice(index + 1)) {
    assert(!rectsOverlap(first.grid, second.grid), `${first.id} overlaps ${second.id}`);
  }
}

for (const link of status.links ?? []) {
  assert(link.info?.trim(), `${link.id} is missing related task info`);
}

assert(Boolean(schema.properties.view), "schema does not document view");
assert(Boolean(schema.properties.categories), "schema does not document categories");
assert(schema.properties.commands.required.includes("init"), "schema does not require commands.init");
assert(schema.properties.tasks.items.properties.state.enum.includes("active"), "schema does not allow active state");
assert(!schema.properties.tasks.items.properties.state.enum.includes("working"), "schema still allows working state");
assert(Boolean(schema.properties.tasks.items.properties.progress), "schema does not document task progress");
assert(!schema.properties.tasks.items.properties.dependsOn, "schema still documents redundant task dependsOn");
assert(Boolean(schema.properties.links.items.properties.info), "schema does not document links[].info");
assert(schema.properties.tasks.items.properties.grid.properties.w.maximum === 1, "schema should keep task grid width to one cell");
assert(schema.properties.tasks.items.properties.grid.properties.h.maximum === 1, "schema should keep task grid height to one cell");

assert(projectConfig.includes("current-project.json"), "project config should persist the local target pointer");
assert(projectConfig.includes("OCB_PROJECT_DIR"), "project config should support external target project dirs");
assert(projectConfig.includes("projects.json"), "project config should persist the local project registry");
assert(projectConfig.includes("TASKS_DIR"), "project config should define the local tasks workspace");
assert(projectConfig.includes("parseRepoInput"), "project config should parse GitHub task repo URLs");
assert(ocb.includes("writeThinProtocolFiles"), "init should write thin task-folder agent entry files");
assert(ocb.includes("listRegisteredProjects"), "helper should list registered task projects");
assert(ocb.includes("findRegisteredProject"), "helper should switch between registered task projects");
assert(viteConfig.includes("resolveProjectConfig"), "local API should resolve the configured target project");
assert(viteConfig.includes("/api/projects"), "local API should expose registered task projects");
assert(viteConfig.includes("/api/project/use"), "local API should support project switching");
assert(viteConfig.includes("collectJsonDataset"), "push endpoint should stage only JSON dataset files");
assert(viteConfig.includes("smartPush"), "push endpoint should run Smart Push when GitHub has newer commits");
assert(viteConfig.includes("mergeStatuses"), "Smart Push should compare base/local/remote task status");
assert(viteConfig.includes("pushProposalBranch"), "Smart Push should save semantic conflicts to proposal branches");
assert(viteConfig.includes("BRANCH_DIVERGED"), "local API should explain diverged Git branches");
assert(viteConfig.includes("REMOTE_AHEAD_BLOCK_PUSH"), "local API should preflight remote-ahead pushes");
assert(viteConfig.includes("LOCAL_CHANGES_BLOCK_PULL"), "local API should explain local changes before pull");
assert(projectConfig.includes("opencollab/Task_Status.json"), "project config should default to target opencollab/Task_Status.json");

assert(app.includes("Project JSON is rendered"), "UI should describe the configured project JSON");
assert(app.includes("Push JSON"), "UI should expose JSON-only push copy");
assert(app.includes("Pull JSON"), "UI should expose JSON-only pull copy");
assert(app.includes("Smart Push is checking remote task updates"), "UI should describe Smart Push progress");
assert(app.includes("saved proposal branch"), "UI should report proposal branch fallback");
assert(app.includes("taskAtGrid(status.tasks, nextGrid, task.id)"), "drag collision check is not wired");
assert(app.includes("onRequestInterdependence(task, hitTask, nextGrid)"), "drag collision does not open interdependence flow");
assert(app.includes("InterdependenceDialog"), "interdependence dialog component is missing");
assert(app.includes("const safeGrid = taskAtGrid(status.tasks, draftGrid) ? findOpenGrid(status.tasks, board) : draftGrid"), "manual task creation can still overlap occupied cells");
assert(app.includes("if (!safeGrid)") && app.includes("Task matrix is full"), "manual task creation does not guard against a full matrix");
assert(app.includes("return null;"), "findOpenGrid should return null when the matrix is full");
assert(app.includes("shares a boundary with ${target}"), "manual related task links do not get related task info");
assert(!app.includes("gsap.to(event.currentTarget"), "hover animation still writes inline transform and can break drag-follow");
assert(app.includes("setMenuOffset({ x: 0, y: 0 });") && app.includes("[task.id]"), "node menu drag offset does not reset when switching tasks");
assert(app.includes("task.claimantId ? \"claimed-color\" : \"unclaimed-color\""), "task tile color is not owner-driven");
assert(app.includes("task.claimantId && task.claimantId !== currentActor?.id"), "related highlight does not exclude current actor tasks");
assert(app.includes("getBoard(status)") && app.includes("status.view?.taskIdPrefix"), "board and id prefix are not driven by Task_Status view data");
assert(app.includes("ProgressControl") && app.includes("onProgressChange"), "progress slider is not wired");
assert(app.includes("\"--tile-opacity\": tileOpacity(progress)"), "task tile opacity is not driven by progress");
assert(app.includes("const width = 1;") && app.includes("gridIsOpen(candidate, occupied)"), "UI should normalize imported tasks to one grid cell");
assert(app.includes("Local changes pending sync"), "unsynced indicator should use professional English copy");
assert(app.includes("formatApiError"), "UI should format structured API errors");
assert(app.includes("/ocb init"), "UI command strip should use /ocb init");
assert(!app.includes("Create link") && !app.includes("connectSource"), "old create-link flow should be removed");
assert(!app.includes(">Active</button>") && !app.includes("Mark Active"), "old active buttons should be removed");

assert(css.includes(".empty-cell"), "empty board cells are not styled");
assert(css.includes(".task-tile.related-highlight"), "related highlight style is missing");
assert(!css.includes("stroke-dasharray") && !css.includes(".board-link"), "dashed link styling should not remain in the matrix UI");
assert(css.includes(".task-tile.state-active"), "active state style is missing");
assert(css.includes(".progress-control") && css.includes(".segmented-progress"), "progress slider styles are missing");
assert(css.includes("white-space: pre-wrap"), "error toast should show full multi-line Git guidance");

assert(framework.includes("The I-TAC-C Check"), "interdependence framework should define the I-TAC-C check");
assert(framework.includes("Conflict Triggers"), "conflict framework should define conflict triggers");
assert(prompts.includes("Prompt A: `/ocb init`"), "prompt library should define /ocb init prompt");
assert(prompts.includes("current task project folder"), "prompt library should be task-folder oriented");
assert(prompts.includes('"taskInterfaces"'), "prompt library should require structured task interface output");
assert(agent.includes("task folder"), "agent prompt should be task-folder oriented");
assert(agent.includes("### /ocb init"), "agent prompt should document /ocb init");
assert(protocol.includes("Repo Model"), "protocol should define parent tool repo vs task project folders");
assert(protocol.includes("/ocb use"), "protocol should define task project switching");
assert(protocol.includes("opencollab/*.json"), "protocol should limit ordinary push to target JSON datasets");

if (failures.length) {
  console.error("OpenCollab verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const occupied = occupiedGridCells(status.tasks ?? []).size;
const taskCount = status.tasks?.length ?? 0;
const progress = taskCount
  ? Math.round(status.tasks.reduce((sum, task) => sum + task.progress, 0) / taskCount)
  : 0;

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedStatus: statusPath,
      board,
      tasks: taskCount,
      links: status.links?.length ?? 0,
      progress,
      emptyCells: board.cols * board.rows - occupied
    },
    null,
    2
  )
);

function occupiedGridCells(tasks) {
  const cells = new Set();
  for (const task of tasks) {
    for (let y = task.grid.y; y < task.grid.y + task.grid.h; y += 1) {
      for (let x = task.grid.x; x < task.grid.x + task.grid.w; x += 1) {
        cells.add(`${x}:${y}`);
      }
    }
  }
  return cells;
}

function rectsOverlap(first, second) {
  return (
    first.x < second.x + second.w &&
    first.x + first.w > second.x &&
    first.y < second.y + second.h &&
    first.y + first.h > second.y
  );
}
