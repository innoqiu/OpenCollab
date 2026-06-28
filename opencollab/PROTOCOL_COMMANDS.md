# OpenCollab Protocol Commands

`/ocb` is a protocol command for local agents. Users type it in Codex, Claude
Code, or another repo-aware agent. The agent reads this OpenCollab tool repo,
then operates on a separate target task repo.

`/ocb` is case-insensitive. Treat `/OCB push` and `/ocb push` the same way.

## Separation Of Repos

OpenCollab has two repositories:

```text
OpenCollab tool repo
  visualizer, prompts, schema, protocol

target task repo
  TASK_BRIEF.md or another task brief
  opencollab/TTask_Status.json
  opencollab/Task_Status.json
  opencollab/Task_Status.schema.json
```

The target task repo is the lightweight cloud state. Ordinary collaboration
pushes must not upload the OpenCollab app, `src/`, `vite.config.js`, prompts, or
agent entry files. Push only the target repo's JSON dataset unless the user
explicitly asks to modify the OpenCollab tool itself.

## First-Run Contract

When an agent sees `/ocb` in the OpenCollab tool repo:

1. Read `AGENTS.md` or `CLAUDE.md` if present.
2. Read `opencollab/AGENT.md`.
3. Read this file.
4. Read `opencollab/Task_Status.schema.json`.
5. Read `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`.
6. Read `opencollab/PROMPTS.md`.
7. Resolve the target task repo from `.opencollab/current-project.json` or from
   the user's command.
8. Read the target repo's task brief.
9. Read target `opencollab/Task_Status.json` if it already exists.

Do not invent a new project protocol if these files exist.

## Command Grammar

```text
/ocb <action> [free text details]
```

Supported actions:

- `def`: define the target task repo folder, task brief, repo URL, and actor.
- `init`: create or refresh the target repo JSON dataset and open the board.
- `run`: compatibility alias for `init`.
- `pull`: pull the target task repo and re-read its JSON dataset.
- `push`: update, commit, and push the target repo JSON dataset.
- `mtg`: add a meeting note to the target repo JSON dataset.
- `help`: summarize available protocol commands.

## /ocb def

Use when setting the local OpenCollab target.

Required or inferable details:

- local target repo folder, for example `../DemoOpenColl2`
- target GitHub repo, for example `innoqiu/DemoOpenColl2`
- task brief file or URL, for example `TASK_BRIEF.md`
- actor id, signature, and color

Agent steps:

1. If the target repo folder does not exist, clone or ask permission to clone it.
2. Save the local target pointer with:

   ```bash
   npm run ocb -- def --project-dir=<folder> --repo=<owner/repo> --brief=<brief-file> --actor=<id> --signature=<text> --color=<hex>
   ```

3. If target `opencollab/Task_Status.json` exists, update only workspace and
   actor identity fields.
4. Do not create timeline events for identity-only changes.

## /ocb init

Use when the target task repo has a brief but may not have an OpenCollab JSON
dataset yet.

Agent steps:

1. Resolve or clone the target task repo.
2. Read the target task brief from the provided GitHub link or local file.
3. Read target `opencollab/Task_Status.json` if it already exists.
4. Use Prompt A plus the task interface framework.
5. Decompose the brief into minimal task interfaces.
6. Infer dependency, boundary, and sync links.
7. Write target `opencollab/TTask_Status.json` as the tiny brief summary.
8. Write target `opencollab/Task_Status.json` as the full visual state.
9. Copy or write target `opencollab/Task_Status.schema.json` if helpful for
   validation.
10. Start the local board with:

    ```bash
    npm run ocb -- init --project-dir=<folder>
    ```

11. Tell the user the local URL.

## /ocb pull

Use when a teammate may have pushed updates to the target repo.

Agent steps:

1. Check local dirty state in the target repo.
2. Run `git pull --ff-only` in the target repo.
3. If Git cannot fast-forward, stop and explain the files that need resolution.
4. Re-read target `opencollab/Task_Status.json`.
5. Summarize changed claims, progress, conflicts, and meeting notes.
6. Do not create a visible timeline event for a clean pull.

## /ocb push

Use after local work, claims, meeting notes, or progress changes should be
published.

Agent steps:

1. Pull the target repo first unless local state makes that unsafe.
2. Inspect target repo changes and local OpenCollab UI changes.
3. Map evidence to task interfaces through `touches[]`, `interfaces.inputs`,
   and `interfaces.outputs`.
4. Update only the target repo JSON dataset.
5. Recompute conflicts from active interdependence and shared touched files.
6. Append exactly one visible target `timeline[]` event of type `update`.
7. Validate or sanity-check target `opencollab/Task_Status.json`.
8. Commit only the target repo's OpenCollab JSON dataset, normally
   `opencollab/*.json`.
9. Push the target repo.
10. Tell the user what changed and whether any conflicts need attention.

The helper script may be used for mechanical pieces:

```bash
npm run ocb -- push
```

The helper stages JSON files in the configured target repo. It does not stage or
push OpenCollab software files.

## /ocb mtg

Use when a meeting, handoff, or boundary decision should be recorded.

Agent steps:

1. Ask for a title and notes if they are missing.
2. Identify related task ids.
3. Add a target `meetings[]` record.
4. Add one target `timeline[]` event of type `meeting`.
5. If a conflict is resolved, mark it resolved and describe the decision.

## Target Repo Minimal Shape

A target repo can be as small as:

```text
TASK_BRIEF.md
opencollab/TTask_Status.json
opencollab/Task_Status.json
opencollab/Task_Status.schema.json
```

Only `TASK_BRIEF.md` is required before `/ocb init`. The JSON files are produced
or updated by the agent.
