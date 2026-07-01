# OpenCollab Agent Entry

This is the OpenCollab **tool repo**. It owns the visualizer, protocol, prompts,
schema, and helper scripts. It is not itself the shared task-state repo.

Task projects live under `tasks/<project-id>/`. Each task folder has its own
brief and JSON dataset:

```text
TASK_BRIEF.md
opencollab/TTask_Status.json
opencollab/Task_Status.json
opencollab/Task_Status.schema.json
```

Treat `/ocb` and `/OCB` as protocol commands typed by the user inside an agent
conversation, not as native shell commands.

## First Read

Before project work or any `/ocb` command, read these files in order:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`
6. `README.md`

Then identify the current task project:

1. Read `.opencollab/current-project.json` if it exists.
2. Otherwise read `.opencollab/projects.json` and use its `current` project.
3. If neither exists, ask for a GitHub task repo URL and run the init helper:

   ```bash
   npm run ocb -- init https://github.com/<owner>/<task-repo>.git
   ```

## Workspace Rules

When the agent workspace is this parent repo:

- Use `npm run ocb -- init <repo-url>` to create or clone a new task folder.
- Use `npm run ocb -- list` to see registered projects.
- Use `npm run ocb -- use <project-id>` to switch the current project.
- Use `npm run ocb -- run` to start the visual board for the current project.

When the agent workspace is a task folder under `tasks/`:

- Read the generated local `AGENTS.md` or `CLAUDE.md` in that task folder.
- Follow its pointer back to this parent OpenCollab repo before handling `/ocb`.
- Edit only that task folder's `opencollab/Task_Status.json` unless the user
  explicitly asks to modify the OpenCollab tool.

Ordinary `/ocb push` must push only the current task project's OpenCollab JSON
dataset. Do not push `src/`, `vite.config.js`, protocol docs, or other tool repo
files unless the user explicitly asks to change OpenCollab itself.
