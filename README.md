# OpenCollab

OpenCollab is a local-first visualization and agent protocol for lightweight
team task coordination. This repository is the **tool repo**: it contains the
visual board, `/ocb` command contract, prompts, schemas, and local helper
scripts.

Each collaboration project lives under `tasks/` as its own **task project
folder**. A task folder can be cloned from a GitHub repo or created locally, and
it stores only the project brief plus the OpenCollab JSON state.

## Intended Shape

```text
OpenCollab tool repo
  src/                         visualizer
  opencollab/                  protocol, schema, prompts
  scripts/ocb.mjs              local helper
  .opencollab/                 ignored local current-project registry
  tasks/                       ignored local task project folders
    owner__RepoA/
      TASK_BRIEF.md
      AGENTS.md                thin local pointer back to parent OpenCollab
      CLAUDE.md                thin local pointer back to parent OpenCollab
      opencollab/
        TTask_Status.json
        Task_Status.json
        Task_Status.schema.json
    owner__RepoB/
      ...
```

The parent OpenCollab repo is downloaded once. New project folders are added
with `/ocb init`, registered locally, and switched with `/ocb use`.

## Setup

Install the visualizer dependencies once in the OpenCollab tool repo:

```bash
npm install
```

Initialize or clone a task project from GitHub:

```bash
npm run ocb -- init https://github.com/innoqiu/DemoOpenColl2.git
```

This command will:

- clone or update the repo into `tasks/innoqiu__DemoOpenColl2`
- initialize missing `TASK_BRIEF.md` and `opencollab/*.json` files
- write thin `AGENTS.md`, `CLAUDE.md`, and `.claude/commands/ocb.md` files in
  the task folder so agents keep access to the parent protocol
- register the task folder as the current OpenCollab project
- start the local visualizer

Open:

[http://localhost:5173](http://localhost:5173)

If `5173` is busy, Vite will print the next available local URL.

## Agent Commands

`/ocb` is a protocol command typed inside Codex, Claude Code, or another
repo-aware agent. It is not a native shell slash command. The helper script
`npm run ocb -- <action>` performs the mechanical local steps after the agent
has read the protocol.

- `/ocb init <repo-url>`: create or update a task folder under `tasks/`, create
  the missing JSON dataset, write thin agent entry files, select the project,
  and start the board.
- `/ocb run`: start the board for the current project.
- `/ocb list`: show registered local task projects.
- `/ocb use <project-id>`: switch the current project.
- `/ocb pull`: run `git pull --ff-only` inside the current task folder and
  reload the JSON dataset.
- `/ocb push`: review local work, update the current task folder's JSON dataset,
  commit only `opencollab/*.json`, and push that task repo.
- `/ocb mtg`: add a meeting note to the current task folder's JSON dataset.

Useful helper examples:

```bash
npm run ocb -- list
npm run ocb -- use innoqiu__DemoOpenColl2
npm run ocb -- run
npm run ocb -- pull
npm run ocb -- push
```

Codex should start from [AGENTS.md](AGENTS.md). Claude Code should start from
[CLAUDE.md](CLAUDE.md) or [.claude/commands/ocb.md](.claude/commands/ocb.md).
The canonical command behavior is in
[opencollab/PROTOCOL_COMMANDS.md](opencollab/PROTOCOL_COMMANDS.md).

## Working From A Task Folder

After `/ocb init`, an agent can switch its workspace into the task folder, for
example:

```text
tasks/innoqiu__DemoOpenColl2/
```

The generated thin entry files in that folder tell the agent where the parent
OpenCollab repo is and which files to read before handling `/ocb`. This prevents
the agent from losing the larger protocol context while editing only one
project's `Task_Status.json`.

Ordinary collaboration pushes must affect only the current task folder. The
parent OpenCollab repo should be committed only when the tool or protocol itself
changes.

## UI Workflow

- `Refresh`: re-read the current task project's `Task_Status.json`.
- `Sync`: write panel edits back to the current task JSON file.
- `Pull JSON`: run `git pull --ff-only` in the current task folder, then reload
  JSON.
- `Push JSON`: commit and push only the current task folder's OpenCollab JSON
  dataset.
- Click a square node to inspect it.
- Empty grid positions open a manual task form at that board position.
- Dragging a task onto another task opens an `Add interdependence` dialog.
- `Claim` assigns the selected node to the current actor.
- The progress slider writes `tasks[].progress`; node opacity follows progress.
- Selecting a node highlights strongly related task interfaces.
- Clicking a conflict highlights the affected task nodes.
- The small `+` at the top of the timeline opens a meeting-note dialog.

## Tool Repo Files

- `src/`: React visual board.
- `vite.config.js`: local API that reads/writes the current task project's JSON.
- `scripts/ocb.mjs`: helper for init, list, use, pull, push, and dev startup.
- `scripts/project-config.mjs`: project resolver and registry.
- `tasks/`: ignored local task project folders.
- `opencollab/Task_Status.schema.json`: JSON schema for target status files.
- `opencollab/templates/`: starter JSON templates for agents.
- `opencollab/AGENT.md`: canonical local-agent protocol.
- `opencollab/PROTOCOL_COMMANDS.md`: `/ocb` command contract.
- `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`: task interface and
  conflict framework.
- `opencollab/PROMPTS.md`: structured prompt library.

The local project registry is stored in `.opencollab/current-project.json` and
`.opencollab/projects.json`; both are ignored by Git.
