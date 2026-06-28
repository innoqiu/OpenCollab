# OpenCollab

OpenCollab is a local-first visualization and agent protocol for lightweight
team task coordination. This repository is the **tool repo**: it contains the
visual board, prompts, schemas, and `/ocb` protocol documents.

The actual project state should live in a separate **target task repo**. That
target repo can stay small: a task brief plus an `opencollab/` folder containing
JSON status files.

## Intended Workflow

```text
target task repo on GitHub
  TASK_BRIEF.md
  opencollab/*.json
        ^
        | git pull / git push JSON dataset only
        |
local OpenCollab tool repo
  localhost visualizer
  agent protocol documents
```

1. A team uploads a task brief to a GitHub repo.
2. Teammates clone or pull this OpenCollab tool repo locally.
3. One person opens OpenCollab in a local agent and types `/ocb init`, giving
   the task brief GitHub link and a local target folder.
4. The agent reads the brief, creates task interfaces, writes the JSON dataset
   into the target repo, and starts the visual board.
5. The team claims tasks and edits the board locally.
6. `/ocb push` commits and pushes only the target repo's OpenCollab JSON dataset.
7. Later teammates pull the same target repo JSON dataset and visualize it with
   their own local OpenCollab copy.

## Setup

Install once in this tool repo:

```bash
npm install
```

Configure a target task repo folder:

```bash
npm run ocb -- def --project-dir=../DemoOpenColl2 --repo=innoqiu/DemoOpenColl2 --brief=TASK_BRIEF.md --actor=mira --signature=MI --color=#65b8a6
```

Start the local visualizer for the configured target:

```bash
npm run ocb -- init
```

Open:

[http://localhost:5173](http://localhost:5173)

If `5173` is busy, Vite will print the next available local URL.

## Agent Commands

`/ocb` is a protocol command typed inside an agent conversation. It is not a
native shell slash command. The helper script `npm run ocb -- <action>` only
performs mechanical local steps after the agent has read the protocol.

- `/ocb def`: configure the target task repo folder, repo URL, current actor,
  and status file.
- `/ocb init`: read the task brief from the target repo or GitHub link, create
  or refresh the JSON dataset, then start the visual board.
- `/ocb pull`: run `git pull --ff-only` inside the target task repo and reload
  the configured JSON dataset.
- `/ocb push`: review local changes, update the configured JSON dataset, commit
  `opencollab/*.json` inside the target task repo, and push that target repo.
- `/ocb mtg`: add a meeting note to the configured JSON dataset.

Codex should start from [AGENTS.md](AGENTS.md). Claude Code should start from
[CLAUDE.md](CLAUDE.md) or [.claude/commands/ocb.md](.claude/commands/ocb.md).
The canonical command behavior is in
[opencollab/PROTOCOL_COMMANDS.md](opencollab/PROTOCOL_COMMANDS.md).

## UI Workflow

- `Refresh`: re-read the configured target project's `Task_Status.json`.
- `Sync`: write panel edits back to the configured target JSON file.
- `Pull JSON`: run `git pull --ff-only` in the target repo, then reload JSON.
- `Push JSON`: commit and push only the target repo's OpenCollab JSON dataset.
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
- `vite.config.js`: local API that reads/writes the configured target JSON.
- `scripts/ocb.mjs`: helper for target repo configuration, pull, push, and dev server startup.
- `scripts/project-config.mjs`: local target project resolver.
- `opencollab/Task_Status.schema.json`: JSON schema for target status files.
- `opencollab/templates/`: starter JSON templates for agents.
- `opencollab/AGENT.md`: canonical local-agent protocol.
- `opencollab/PROTOCOL_COMMANDS.md`: `/ocb` command contract.
- `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`: task interface and conflict framework.
- `opencollab/PROMPTS.md`: structured prompt library.

The local target pointer is stored in `.opencollab/current-project.json` and is
ignored by Git.
