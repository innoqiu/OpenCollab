# OpenCollab Protocol Commands

`/ocb` is a protocol command for local agents. Users type it in Codex, Claude
Code, or another repo-aware agent. The agent reads this OpenCollab tool repo,
then operates on one task project folder at a time.

`/ocb` is case-insensitive. Treat `/OCB push` and `/ocb push` the same way.

## Repo Model

OpenCollab has one parent tool repo and many local task project folders:

```text
OpenCollab tool repo
  visualizer, prompts, schema, protocol
  tasks/
    owner__ProjectA/
      TASK_BRIEF.md
      AGENTS.md
      CLAUDE.md
      opencollab/*.json
    owner__ProjectB/
      ...
```

The `tasks/` folder is ignored by the parent tool repo. Each task folder can be
a Git clone of a lightweight task repo. Ordinary collaboration pushes must not
upload the OpenCollab app, `src/`, `vite.config.js`, prompts, or protocol files.
Push only the current task folder's `opencollab/*.json` dataset unless the user
explicitly asks to modify the OpenCollab tool itself.

## First-Run Contract

When an agent sees `/ocb` in the OpenCollab tool repo:

1. Read `AGENTS.md` or `CLAUDE.md` if present.
2. Read `opencollab/AGENT.md`.
3. Read this file.
4. Read `opencollab/Task_Status.schema.json`.
5. Read `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`.
6. Read `opencollab/PROMPTS.md`.
7. Resolve the current task project from `.opencollab/current-project.json` or
   `.opencollab/projects.json`.
8. If no project is configured, ask for a GitHub task repo URL and run
   `npm run ocb -- init <repo-url>`.
9. Read the current task folder's `TASK_BRIEF.md`,
   `opencollab/TTask_Status.json`, and `opencollab/Task_Status.json`.

When an agent starts inside `tasks/<project-id>/`, first read that folder's
generated `AGENTS.md` or `CLAUDE.md`. It points back to the parent OpenCollab
repo and names the current project id.

Do not invent a new project protocol if these files exist.

## Command Grammar

```text
/ocb <action> [free text details]
```

Supported actions:

- `init`: create or clone a task project folder, initialize missing JSON files,
  write thin local agent entry files, select the project, and open the board.
- `run`: open the board for the current project.
- `list`: show locally registered task projects.
- `use`: switch the current task project.
- `pull`: pull the current task project and re-read its JSON dataset.
- `push`: update, commit, and push the current task project's JSON dataset.
- `mtg`: add a meeting note to the current task project's JSON dataset.
- `def`: update current project actor identity and legacy target settings.
- `help`: summarize available protocol commands.

## /ocb init

Use when starting a new task project or onboarding a GitHub task repo.

Required or inferable details:

- GitHub task repo URL, for example `https://github.com/innoqiu/DemoOpenColl2.git`
- optional member list
- optional actor id, signature, and color

Agent steps:

1. Read the first-run files in the parent OpenCollab repo.
2. If a repo URL is provided, run:

   ```bash
   npm run ocb -- init <repo-url>
   ```

3. The helper clones or updates the repo into `tasks/<owner>__<repo>`.
4. If the task folder does not contain `TASK_BRIEF.md`, the helper creates a
   starter brief and the agent must ask the user to confirm the actual task.
5. If JSON files are missing, the helper initializes:
   - `opencollab/TTask_Status.json`
   - `opencollab/Task_Status.json`
   - `opencollab/Task_Status.schema.json`
6. The helper writes thin task-folder entry files:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.claude/commands/ocb.md`
7. Read the task brief and use Prompt A plus the task interface framework.
8. Decompose the brief into minimal task interfaces.
9. Infer dependency, boundary, and sync links.
10. Update the task folder's `opencollab/TTask_Status.json` and
    `opencollab/Task_Status.json`.
11. Tell the user the task folder path and local board URL.

## /ocb run

Use when the current task project is already configured and the user only wants
to open the visual board.

Helper:

```bash
npm run ocb -- run
```

If no project is configured, ask for a GitHub task repo URL and run `/ocb init`
instead.

## /ocb list

Show all locally registered task projects:

```bash
npm run ocb -- list
```

Use this before switching if the user does not name the exact project id.

## /ocb use

Switch the current task project:

```bash
npm run ocb -- use <project-id>
```

After switching, re-read that task folder's `Task_Status.json` before making
claims, progress changes, conflict analysis, pull, or push decisions.

## /ocb def

Legacy command for updating the current project pointer and actor identity.
Prefer `/ocb init <repo-url>` for first setup.

Agent behavior:

1. Resolve or create the local task project folder.
2. Save the local current-project pointer.
3. If the task status file exists, update `workspace.currentActorId` and the
   matching `members[]` record.
4. Do not create timeline events for identity-only changes.

## /ocb pull

Use when a teammate may have pushed updates to the current task project.

Agent steps:

1. Check local dirty state in the current task folder.
2. Run `git pull --ff-only` in that task folder.
3. If Git cannot fast-forward, stop and explain the files that need resolution.
4. Re-read `opencollab/Task_Status.json`.
5. Summarize changed claims, progress, conflicts, and meeting notes.
6. Do not create a visible timeline event for a clean pull.

Helper:

```bash
npm run ocb -- pull
```

## /ocb push

Use after local work, claims, meeting notes, or progress changes should be
published.

Agent steps:

1. Pull the current task folder first unless local state makes that unsafe.
2. Inspect local work and OpenCollab UI changes.
3. Map evidence to task interfaces through `touches[]`, `interfaces.inputs`,
   and `interfaces.outputs`.
4. Update only the current task folder's JSON dataset.
5. Recompute conflicts from active interdependence and shared touched files.
6. Append exactly one visible `timeline[]` event of type `update`.
7. Validate or sanity-check `opencollab/Task_Status.json`.
8. Commit only the current task folder's OpenCollab JSON dataset, normally
   `opencollab/*.json`.
9. Push the current task repo.
10. Tell the user what changed and whether any conflicts need attention.

Helper:

```bash
npm run ocb -- push
```

## /ocb mtg

Use when a meeting, handoff, or boundary decision should be recorded.

Agent steps:

1. Ask for a title and notes if they are missing.
2. Identify related task ids.
3. Add a `meetings[]` record.
4. Add one `timeline[]` event of type `meeting`.
5. If a conflict is resolved, mark it resolved and describe the decision.

## Task Folder Minimal Shape

A task folder can be as small as:

```text
TASK_BRIEF.md
opencollab/TTask_Status.json
opencollab/Task_Status.json
opencollab/Task_Status.schema.json
```

Only `TASK_BRIEF.md` is required before `/ocb init`. The JSON files are produced
or updated by the agent and helper.
