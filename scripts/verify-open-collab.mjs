import fs from "node:fs";

const allowedStates = new Set(["undo", "claimed", "active", "done"]);

const status = JSON.parse(fs.readFileSync("opencollab/Task_Status.json", "utf8"));
const schema = JSON.parse(fs.readFileSync("opencollab/Task_Status.schema.json", "utf8"));
const app = fs.readFileSync("src/App.jsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const agent = fs.readFileSync("opencollab/AGENT.md", "utf8");
const framework = fs.readFileSync("opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md", "utf8");
const prompts = fs.readFileSync("opencollab/PROMPTS.md", "utf8");
const protocol = fs.readFileSync("opencollab/PROTOCOL_COMMANDS.md", "utf8");
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
assert(Boolean(status.workspace?.repo), "workspace.repo is missing");
assert((status.members ?? []).length === 4, "demo should have exactly four participating members");
assert((status.members ?? []).every((member) => member.role === "human"), "demo members should be four human teammates");
assert(Boolean(status.commands?.init), "commands.init is missing");
assert(Boolean(status.protocol?.interdependenceFramework), "protocol.interdependenceFramework is missing");
assert(Boolean(status.protocol?.promptLibrary), "protocol.promptLibrary is missing");
assert(Boolean(status.protocol?.commandProtocol), "protocol.commandProtocol is missing");

for (const task of status.tasks ?? []) {
  assert(allowedStates.has(task.state), `${task.id} has unsupported state ${task.state}`);
  assert(Number.isInteger(task.progress) && task.progress >= 0 && task.progress <= 100, `${task.id} has invalid progress`);
  assert(!("dependsOn" in task), `${task.id} still has redundant dependsOn; dependency links should be in links[]`);
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

for (const member of status.members ?? []) {
  assert(member.displayName !== "Project Lead", `${member.id} still uses a role title instead of a name`);
}

assert(Boolean(schema.properties.view), "schema does not document view");
assert(Boolean(schema.properties.categories), "schema does not document categories");
assert(schema.properties.commands.required.includes("init"), "schema does not require commands.init");
assert(schema.properties.tasks.items.properties.state.enum.includes("active"), "schema does not allow active state");
assert(!schema.properties.tasks.items.properties.state.enum.includes("working"), "schema still allows working state");
assert(Boolean(schema.properties.tasks.items.properties.progress), "schema does not document task progress");
assert(!schema.properties.tasks.items.properties.dependsOn, "schema still documents redundant task dependsOn");
assert(Boolean(schema.properties.links.items.properties.info), "schema does not document links[].info");
assert(!schema.properties.classification, "schema still documents redundant classification");

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
assert(app.includes("className={`node-menu ${canPlaceRight ? \"right-side\" : \"left-side\"}`"), "node menu is not positioned beside the selected cell");
assert(app.includes("Local changes pending sync"), "unsynced indicator should use professional English copy");
assert(app.includes("/ocb init"), "UI command strip should use /ocb init");
assert(!app.includes("Create link") && !app.includes("connectSource"), "old create-link flow should be removed");
assert(!app.includes(">Active</button>") && !app.includes("Mark Active"), "old active buttons should be removed");
assert(!app.includes("AIP-"), "visualization code should not contain demo task id prefixes");

assert(css.includes(".empty-cell"), "empty board cells are not styled");
assert(css.includes(".task-tile.related-highlight"), "related highlight style is missing");
assert(css.includes("rgba(226, 229, 236"), "related highlight is not using a gray frame");
assert(/\.task-tile\.related-highlight[\s\S]*animation:\s*none/.test(css), "related highlight should disable state animations so the gray frame stays visible");
assert(!css.includes("stroke-dasharray") && !css.includes(".board-link"), "dashed link styling should not remain in the matrix UI");
assert(css.includes(".task-tile.state-active"), "active state style is missing");
assert(css.includes(".actor-row"), "right-side actor rows are not styled");
assert(css.includes(".related-docs"), "related task info section is not styled");
assert(css.includes(".progress-control") && css.includes(".segmented-progress"), "progress slider styles are missing");
assert(css.includes("opacity: var(--tile-opacity"), "tile opacity style is not progress-driven");

assert(framework.includes("The I-TAC-C Check"), "interdependence framework should define the I-TAC-C check");
assert(framework.includes("Conflict Triggers"), "conflict framework should define conflict triggers");
assert(prompts.includes("Prompt A: `/ocb init`"), "prompt library should define /ocb init prompt");
assert(prompts.includes("Prompt F: `/ocb push`"), "prompt library should define /ocb push prompt");
assert(prompts.includes('"taskInterfaces"'), "prompt library should require structured task interface output");
assert(agent.includes("### /ocb init"), "agent prompt should document /ocb init");
assert(agent.includes("opencollab/PROMPTS.md"), "agent prompt should reference structured prompts");
assert(protocol.includes("conversation-level protocol command") || protocol.includes("protocol command for local agents"), "protocol docs should define /ocb as an agent protocol command");
assert(protocol.includes("/ocb push"), "protocol docs should document /ocb push");

if (failures.length) {
  console.error("OpenCollab verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      board,
      tasks: status.tasks.length,
      links: status.links.length,
      states: [...new Set(status.tasks.map((task) => task.state))],
      progress: Math.round(status.tasks.reduce((sum, task) => sum + task.progress, 0) / status.tasks.length),
      emptyCells: board.cols * board.rows - occupiedGridCells(status.tasks).size
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
