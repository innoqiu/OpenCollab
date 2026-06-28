# OpenCollab Agent Prompt

You are working inside the OpenCollab tool repo. OpenCollab is local-first:
the visualizer and prompts live here, while each team project's lightweight
task state lives in a separate target GitHub repo.

## First Read

Before changing anything, read these files in order:

1. `AGENTS.md` or `CLAUDE.md` when present
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`
6. `opencollab/AGENT.md`
7. `README.md`

Then resolve the target task repo. If `.opencollab/current-project.json` exists,
read it. Otherwise ask for or infer the local target folder and task brief link.

Treat the target repo's `opencollab/Task_Status.json` as the shared source of
truth. Do not treat this tool repo as the cloud task state.

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

### /ocb def

Configure the local target task repo and actor identity.

Agent behavior:

1. Resolve or create the local target repo folder.
2. Save `.opencollab/current-project.json` through the helper:

   ```bash
   npm run ocb -- def --project-dir=<folder> --repo=<owner/repo> --brief=<brief-file> --actor=<id> --signature=<text> --color=<hex>
   ```

3. If the target status file exists, update target `workspace.currentActorId`
   and the matching target `members[]` record.
4. Do not create a visible timeline node for identity-only changes.

### /ocb init

Initialize a task map from a task brief in the target task repo.

Required information:

- target task brief GitHub URL or local path
- local target repo folder
- optional member list

Agent behavior:

1. Read the first-read files in this tool repo.
2. Clone or pull the target task repo if needed.
3. Read the target task brief.
4. Use Prompt A from `opencollab/PROMPTS.md`.
5. Identify final deliverable, audience, constraints, and known members.
6. Decompose work into task interfaces.
7. Use the I-TAC-C check to infer interdependence.
8. Write or update target `opencollab/TTask_Status.json`.
9. Write or update target `opencollab/Task_Status.json`.
10. Write or copy target `opencollab/Task_Status.schema.json` when useful.
11. Start the local visual system with `npm run ocb -- init --project-dir=<folder>`.
12. Tell the user the local URL.

### /ocb run

Compatibility alias for `/ocb init`.

### /ocb pull

Pull the latest shared state from the target task repo.

Agent behavior:

1. Use Prompt E from `opencollab/PROMPTS.md`.
2. Run `git pull --ff-only` in the target repo.
3. If Git reports conflicts, stop and explain which target files need resolution.
4. Re-read target `opencollab/Task_Status.json`.
5. Do not create a visible timeline node for a clean pull.
6. Do not rewrite task ownership merely because a pull happened.

### /ocb push

Review local work, update the target JSON dataset, then push the target repo.

Agent behavior:

1. Use Prompt F from `opencollab/PROMPTS.md`.
2. Pull the target repo first when safe.
3. Inspect today's local work and target repo changes.
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
9. Append exactly one visible target `timeline` event of type `update`.
10. Save target `opencollab/Task_Status.json`.
11. Commit only target `opencollab/*.json`.
12. Run `git push` in the target repo.
13. Reload or tell the user to refresh the local visualization.

Do not commit or push the OpenCollab tool repo during ordinary `/ocb push`.

### /ocb mtg

Add a manual meeting marker to the target JSON dataset.

Agent behavior:

1. Use Prompt G from `opencollab/PROMPTS.md`.
2. Read target `opencollab/Task_Status.json`.
3. Create a target `meetings[]` record.
4. Append one visible target `timeline` event of type `meeting`.
5. If a meeting explicitly resolves a conflict, mark that conflict resolved and
   name the decision.
6. Save target `opencollab/Task_Status.json`.

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
- Other local actions may change JSON, but should not become visible timeline nodes.

## Conflict Rules

Recompute conflicts before `/ocb push`.

Create a conflict when:

- linked tasks with `kind: "boundary"` or `kind: "sync"` are both active and owned by different members
- two active tasks owned by different members touch the same file
- a task at `progress: 100` depends on a task below `progress: 100`
- two people attempted to claim the same task in the same synchronization window

Write conflicts to target `conflicts[]` with:

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
language summary can be short, but the structured result should be precise enough
for another agent to update target `Task_Status.json` without guessing.
