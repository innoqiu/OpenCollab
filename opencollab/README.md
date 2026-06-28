# OpenCollab Workspace

OpenCollab treats a GitHub repository as the shared source of truth for a team project.
Local agents read this folder first, update the task report locally, and then push the
result back to the repository.

## Local-first workflow

1. `/ocb def` locks workspace metadata and actor signature/color.
2. `/ocb init` analyzes the task brief and cloud document, then starts the local visual system at `http://localhost:5173`.
3. The visual UI reads and writes `opencollab/Task_Status.json` through a local API.
4. Teammates claim task interfaces and move `progress` from 0 to 100.
5. Task state is still stored, but it follows ownership and progress: `undo`, `claimed`, `active`, or `done`.
6. The UI `Sync` action writes panel changes back to `Task_Status.json`.
7. `/ocb pull` runs `git pull --ff-only` and refreshes the shared JSON.
8. `/ocb push` lets the agent review today's work, update JSON, recompute conflicts, commit, and push.

`/ocb run` remains a compatibility alias for `/ocb init` during the demo period.

## Files

- `AGENT.md`: the local-agent operating prompt.
- `PROTOCOL_COMMANDS.md`: the conversation-level `/ocb` command contract.
- `INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`: definitions and detection rules for interdependence and conflicts.
- `PROMPTS.md`: structured prompt templates for init, task decomposition, interdependence, conflict, pull, push, and meetings.
- `Task_Status.json`: source of truth for view layout, tasks, progress, links, members, timeline, meetings, and conflicts.
- `Task_Status.schema.json`: JSON schema for the source of truth.
- `interfaces/README.md`: interface contract conventions.
