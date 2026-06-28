# OpenCollab

OpenCollab is a local-first task collaboration mockup. A local visual system reads and
writes `opencollab/Task_Status.json`; teammates keep that JSON synchronized through
GitHub; local agents read the same file to initialize task maps, update task progress,
detect conflicts, and prepare pushes.

The current demo is a four-person course project: **Campus Study Space Finder**.
It models research, data, prototype, and evaluation/reporting work for a small
team assignment.

## Current architecture

```text
GitHub repo
  |
  | git pull / git push
  v
opencollab/Task_Status.json  <->  localhost:5173 local API  <->  React pixel board UI
        ^
        |
        local agent reads AGENT.md and updates JSON during /ocb init or /ocb push
```

## Run locally

Install once:

```bash
npm install
```

Start the local service and visual UI:

```bash
npm run dev
```

Open:

[http://localhost:5173](http://localhost:5173)

## UI workflow

- `Refresh`: re-read `opencollab/Task_Status.json` from disk.
- `Sync`: write current panel edits back to `Task_Status.json`.
- `Git Pull`: run `git pull --ff-only`, then reload JSON.
- `Git Push`: writes JSON, stages OpenCollab files, commits, and runs `git push`.
- Click a square node to inspect it.
- Empty grid positions open a manual task form at that board position.
- Dragging a task onto another task opens an `Add interdependence` dialog instead of overlapping them.
- `Claim` assigns the selected node to the current actor.
- The progress slider writes `tasks[].progress`; node opacity follows that progress value.
- Selecting a node highlights strongly related task interfaces instead of drawing dashed links.
- Clicking a conflict in the inspector highlights the affected task nodes.
- The member manager in the inspector selects, adds, edits, colors, and deletes actors.
- The small `+` at the top of the timeline opens a focused meeting-note dialog.

## Agent commands

`/ocb` is a protocol command typed inside an agent conversation. It is not a
native shell slash command. The repository ships agent entry files so downloaded
projects can teach local agents how to handle `/ocb`:

- [AGENTS.md](AGENTS.md): Codex/project-level entry.
- [CLAUDE.md](CLAUDE.md): Claude Code memory entry.
- [.claude/commands/ocb.md](.claude/commands/ocb.md): Claude Code slash command wrapper.
- [opencollab/AGENT.md](opencollab/AGENT.md): canonical OpenCollab agent protocol.
- [opencollab/PROTOCOL_COMMANDS.md](opencollab/PROTOCOL_COMMANDS.md): command behavior spec.

When a user types `/ocb push` in Codex or Claude, the agent should read those
files, inspect local work, update `Task_Status.json`, and then commit/push. The
helper script below can perform mechanical steps, but it does not replace the
agent's review.

- `/ocb def`: initialize repo, workspace, actor signature, and actor color.
- `/ocb init`: initialize a task map from a task brief and cloud document, then start the visual system.
- `/ocb run`: compatibility alias for `/ocb init` during the demo period.
- `/ocb pull`: pull latest GitHub state.
- `/ocb push`: review today's local work, update JSON, check conflicts, commit, and push.

A small helper is also available:

```bash
npm run ocb -- help
npm run ocb -- def --repo=innoqiu/OpenCollab --workspace="OpenCollab Local Mockup" --actor=iq --signature=IQ --color=#29d8d0
npm run ocb -- init
npm run ocb -- pull
npm run ocb -- push
```

## Install the agent entry in another repo

From this repository, copy the OpenCollab agent entry into another local project:

```bash
npm run agent:install -- --target=../DemoOpenColl
```

This installs `AGENTS.md`, `CLAUDE.md`, `.claude/commands/ocb.md`, and the
canonical OpenCollab protocol documents. The target project still needs its own
`opencollab/Task_Status.json`; after that, open the target repo in Codex or
Claude and type `/ocb init`.

## Data files

- `opencollab/Task_Status.json`: source of truth for board view, members, categories, tasks, progress, links, timeline, meetings, and conflicts.
- `opencollab/Task_Status.schema.json`: schema used by agents and future validators.
- `opencollab/AGENT.md`: local-agent command and JSON update protocol.
- `opencollab/PROTOCOL_COMMANDS.md`: agent-facing `/ocb` command contract.
- `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`: general framework for task interdependence and conflict.
- `opencollab/PROMPTS.md`: structured prompt library for init, task analysis, interdependence, conflict, pull, push, and meetings.
- `opencollab/interfaces/README.md`: task interface and boundary contract conventions.
