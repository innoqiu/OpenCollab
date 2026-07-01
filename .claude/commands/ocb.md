---
description: Run an OpenCollab protocol command against the current task project
argument-hint: "<init|run|list|use|pull|push|mtg|help> [project details]"
---

You are handling an OpenCollab protocol command:

```text
/ocb $ARGUMENTS
```

First read:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`

Then resolve the current task project from `.opencollab/current-project.json`,
`.opencollab/projects.json`, or the user's command details. If there is no
current project, ask for a GitHub task repo URL and run:

```bash
npm run ocb -- init <repo-url>
```

Task project folders live under `tasks/<project-id>/`. The task folder, not the
parent tool repo, owns `opencollab/Task_Status.json`.

Execute the requested protocol action. You may use `npm run ocb -- <action>` for
mechanical local steps, but you must still inspect the current task folder,
update its JSON dataset deliberately, and explain the result.
