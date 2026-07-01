# OpenCollab Agent Prompt

You are working with OpenCollab. OpenCollab is local-first: the visualizer,
prompts, command contract, and schema live in the parent tool repo; each team
project lives in a separate local task folder under `tasks/`.

## First Read

Before changing anything, read these files in order:

1. `AGENTS.md` or `CLAUDE.md` when present
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`
6. `opencollab/AGENT.md`
7. `README.md`

Then resolve the current task project:

1. Read `.opencollab/current-project.json` if it exists.
2. Otherwise read `.opencollab/projects.json` if it exists.
3. If no project exists, ask for a GitHub task repo URL and initialize it with:

   ```bash
   npm run ocb -- init https://github.com/<owner>/<task-repo>.git
   ```

The current task folder's `opencollab/Task_Status.json` is the shared source of
truth. Do not treat the parent OpenCollab tool repo as the cloud task state.

If the agent starts inside a task folder, read that folder's generated
`AGENTS.md` or `CLAUDE.md`; it points back to the parent OpenCollab repo.

`/ocb` is a conversation-level protocol command. If the user types `/OCB pull`,
`/ocb pull`, or similar text inside the agent UI, follow this document and
`opencollab/PROTOCOL_COMMANDS.md`.

## Core Concepts

- `task interface`: the smallest ownable task unit with clear inputs, outputs,
  owner surface, evidence, and boundary notes.
- `interdependence`: any relationship where one task can change another task's
  correctness, timing, scope, or usability.
- `conflict`: a current risky state on top of interdependence, not merely the
  existence of a link.

Use `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md` as the canonical
definition source.

## Commands

### /ocb init

Initialize a task folder from a GitHub task repo or create a local starter task
folder.

Agent behavior:

1. Read the first-read files in the parent tool repo.
2. Ask for the GitHub task repo URL if the user has not provided one.
3. Run the helper:

   ```bash
   npm run ocb -- init <repo-url>
   ```

4. The helper clones or updates `tasks/<owner>__<repo>`, initializes missing
   JSON files, writes thin agent entry files into the task folder, registers it,
   and starts the board.
5. Read the task folder's `TASK_BRIEF.md`.
6. Use Prompt A from `opencollab/PROMPTS.md`.
7. Identify final deliverable, audience, constraints, and known members.
8. Decompose work into task interfaces.
9. Use the I-TAC-C check to infer interdependence.
10. Write or update the task folder's `opencollab/TTask_Status.json`.
11. Write or update the task folder's `opencollab/Task_Status.json`.
12. Tell the user the local URL and task folder path.

### /ocb run

Start the visual board for the current task project.

```bash
npm run ocb -- run
```

If no current project is configured, ask for a repo URL and use `/ocb init`
instead.

### /ocb list

List registered task projects:

```bash
npm run ocb -- list
```

Use this when the user asks which project is active or wants to switch.

### /ocb use

Switch to a registered task project:

```bash
npm run ocb -- use <project-id>
```

After switching, re-read that project's `opencollab/Task_Status.json`.

### /ocb def

Legacy command for updating current project settings or actor identity. Prefer
`/ocb init <repo-url>` for first setup.

Agent behavior:

1. Resolve or create the local task project folder.
2. Save `.opencollab/current-project.json` through the helper.
3. If the task status file exists, update `workspace.currentActorId` and the
   matching `members[]` record.
4. Do not create a visible timeline node for identity-only changes.

### /ocb pull

Pull the latest shared state from the current task folder's Git repo.

Agent behavior:

1. Use Prompt E from `opencollab/PROMPTS.md`.
2. Run `git pull --ff-only` in the current task folder.
3. If Git reports conflicts, stop and explain which task-folder files need
   resolution.
4. Re-read `opencollab/Task_Status.json`.
5. Do not create a visible timeline node for a clean pull.
6. Do not rewrite task ownership merely because a pull happened.

### /ocb push

Review local work, update the current task folder's JSON dataset, then push that
task repo.

Agent behavior:

1. Use Prompt F from `opencollab/PROMPTS.md`.
2. Pull the current task repo first when safe.
3. Inspect today's local work and task folder changes.
4. Map changes to task interfaces using `touches[]`, `interfaces.outputs`, and
   artifact paths.
5. For every touched task interface:
   - update `progress` from 0 to 100 using evidence from local work
   - set `state` to `active` when `progress` is above 0 and below 100
   - set `state` to `done` when `progress` is 100 and ready for boundary review
   - keep `state` as `claimed` when ownership exists but `progress` is still 0
   - keep `state` as `undo` when the task is unclaimed and `progress` is 0
6. Update `touches`, `interfaces.outputs`, and `updatedAt` when evidence changed.
7. Recompute `links[]` only when the task interface contract changed.
8. Recompute `conflicts[]`.
9. Append exactly one visible `timeline` event of type `update`.
10. Save the current task folder's `opencollab/Task_Status.json`.
11. Commit only the current task folder's `opencollab/*.json`.
12. Run `git push` in the current task folder.
13. Reload or tell the user to refresh the local visualization.

Do not commit or push the parent OpenCollab tool repo during ordinary
`/ocb push`.

### /ocb mtg

Add a manual meeting marker to the current task folder's JSON dataset.

Agent behavior:

1. Use Prompt G from `opencollab/PROMPTS.md`.
2. Read the current task folder's `opencollab/Task_Status.json`.
3. Create a `meetings[]` record.
4. Append one visible `timeline` event of type `meeting`.
5. If a meeting explicitly resolves a conflict, mark that conflict resolved and
   name the decision.
6. Save `opencollab/Task_Status.json`.

## JSON Update Rules

Use these exact state values:

- `undo`: unclaimed or not started
- `claimed`: owned, not visibly started
- `active`: visible local progress exists
- `done`: ready for boundary review or merge

Use `progress` as the primary visual completion interface:

- `progress` must be an integer from 0 to 100.
- `progress: 0` plus no owner means `state: "undo"`.
- `progress: 0` plus an owner means `state: "claimed"`.
- `progress: 1..99` means `state: "active"`.
- `progress: 100` means `state: "done"`.

Every task update should preserve:

- `id`
- `grid`
- `category`
- existing `interfaces` fields unless the task contract actually changed

Visible timeline rules:

- `update` appears only during `/ocb push`, after the agent reviews local work.
- `meeting` appears only through `/ocb mtg` or the visual meeting form.
- Other local actions may change JSON, but should not become visible timeline
  nodes.

## Conflict Rules

Recompute conflicts before `/ocb push`.

Create a conflict when:

- linked tasks with `kind: "boundary"` or `kind: "sync"` are both active and
  owned by different members
- two active tasks owned by different members touch the same file
- a task at `progress: 100` depends on a task below `progress: 100`
- two people attempted to claim the same task in the same synchronization window

Write conflicts to `conflicts[]` with:

- stable `id`
- `type`
- `severity`
- `taskIds`
- `memberIds`
- `title`
- `message`
- `detectedAt`
- `resolved`

## Output Discipline

Whenever you analyze tasks, interdependence, conflicts, pull, push, or meetings,
produce the structured output requested in `opencollab/PROMPTS.md`. The natural
language summary can be short, but the structured result should be precise
enough for another agent to update `Task_Status.json` without guessing.
