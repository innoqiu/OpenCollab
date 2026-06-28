---
description: Run an OpenCollab protocol command
argument-hint: "<init|pull|push|mtg|def> [details]"
---

You are handling an OpenCollab protocol command:

```text
/ocb $ARGUMENTS
```

First read:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.json`
4. `opencollab/Task_Status.schema.json`
5. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
6. `opencollab/PROMPTS.md`

Then execute the requested protocol action. `/ocb` is not a native shell
command; it is a collaboration instruction. You may use `npm run ocb -- <action>`
for mechanical helper steps, but you must still inspect local work, update
`opencollab/Task_Status.json`, and explain the result.
