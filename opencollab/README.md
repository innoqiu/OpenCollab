# OpenCollab Tool Protocol

This folder belongs to the OpenCollab tool repo. It contains protocol,
templates, schemas, and prompts used by local agents.

The live collaboration state usually lives in a separate target task repo:

```text
<target-repo>/opencollab/Task_Status.json
```

## Files

- `AGENT.md`: canonical local-agent operating prompt.
- `PROTOCOL_COMMANDS.md`: conversation-level `/ocb` command contract.
- `Task_Status.schema.json`: JSON schema for target status files.
- `INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`: definitions and detection rules for interdependence and conflicts.
- `PROMPTS.md`: structured prompt templates for init, task decomposition, interdependence, conflict, pull, push, and meetings.
- `interfaces/README.md`: interface contract conventions.
- `templates/`: starter JSON templates an agent can copy into a target task repo during `/ocb init`.

## Local-First Workflow

1. `/ocb def` configures the local target task repo.
2. `/ocb init` reads the target task brief and writes target `opencollab/*.json`.
3. The visual UI reads and writes the configured target `Task_Status.json`.
4. `/ocb pull` runs `git pull --ff-only` in the target repo and refreshes JSON.
5. `/ocb push` commits and pushes only the target repo's OpenCollab JSON dataset.
