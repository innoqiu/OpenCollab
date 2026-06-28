# OpenCollab Agent Entry

This is the OpenCollab **tool repo**, not the task project's cloud state repo.
Treat `/ocb` and `/OCB` as protocol commands typed by the user inside an agent
conversation, not as native shell commands.

Before project work or any `/ocb` command, read these files in order:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`
6. `README.md`

Then identify the configured target task repo. If `.opencollab/current-project.json`
exists, use it. If not, ask for or infer:

- local target repo folder, for example `../DemoOpenColl2`
- task brief URL or file, for example `TASK_BRIEF.md`
- target GitHub repo, for example `innoqiu/DemoOpenColl2`
- current actor id/signature/color

The shared collaboration state is in the target task repo, normally:

```text
<target-repo>/opencollab/Task_Status.json
```

Do not push the OpenCollab tool repo during ordinary `/ocb push`. Push only the
target task repo's OpenCollab JSON dataset unless the user explicitly asks to
change the OpenCollab software itself.
