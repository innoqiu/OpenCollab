---
description: Run an OpenCollab protocol command against a target task repo
argument-hint: "<def|init|pull|push|mtg|help> [project details]"
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

Then resolve the target task repository from `.opencollab/current-project.json`
or from the user's command details. The target repository, not this tool repo,
owns `opencollab/Task_Status.json`.

Execute the requested protocol action. You may use `npm run ocb -- <action>` for
mechanical local steps, but you must still inspect the target repo, update its
JSON dataset deliberately, and explain the result.
