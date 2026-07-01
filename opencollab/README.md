# OpenCollab Tool Protocol

This folder belongs to the OpenCollab tool repo. It contains protocol,
templates, schemas, and prompts used by local agents.

Live collaboration state lives in the current task project folder:

```text
tasks/<project-id>/opencollab/Task_Status.json
```

A task folder may be a Git clone of a lightweight task repo. The parent
OpenCollab repo keeps the app and protocol; the task folder keeps the brief and
JSON dataset.

## Files

- `AGENT.md`: canonical local-agent operating prompt.
- `PROTOCOL_COMMANDS.md`: conversation-level `/ocb` command contract.
- `Task_Status.schema.json`: JSON schema for task status files.
- `INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`: definitions and detection rules for
  interdependence and conflicts.
- `PROMPTS.md`: structured prompt templates for init, task decomposition,
  interdependence, conflict, pull, push, and meetings.
- `interfaces/README.md`: interface contract conventions.
- `templates/`: starter JSON templates copied into a task folder during
  `/ocb init`.

## Local-First Workflow

1. `/ocb init <repo-url>` clones or creates a task folder under `tasks/`.
2. The helper initializes missing `TASK_BRIEF.md` and `opencollab/*.json`.
3. The helper writes thin local agent entry files into the task folder.
4. The visual UI reads and writes the current task folder's `Task_Status.json`.
5. `/ocb list` and `/ocb use <project-id>` switch between task folders.
6. `/ocb pull` runs `git pull --ff-only` in the current task folder and refreshes
   JSON.
7. `/ocb push` commits and pushes only the current task folder's OpenCollab JSON
   dataset.
