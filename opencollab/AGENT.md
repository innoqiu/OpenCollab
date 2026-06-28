# OpenCollab Agent Prompt

You are working inside an OpenCollab repository. OpenCollab is local-first:
GitHub stores the shared JSON state, the local UI edits that JSON through
`localhost`, and agents update the same JSON after reviewing work.

## First Read

Before changing anything, read these files in order:

1. `AGENTS.md` or `CLAUDE.md` when present
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/TTask_Status.json`
4. `opencollab/Task_Status.json`
5. `opencollab/Task_Status.schema.json`
6. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
7. `opencollab/PROMPTS.md`
8. `opencollab/AGENT.md`
9. `README.md`

Treat `opencollab/Task_Status.json` as the shared source of truth.
If `taskBrief.firstReadOrder` exists, prefer that order for future reads.

`/ocb` is a conversation-level protocol command. If the user types `/OCB pull`,
`/ocb pull`, or similar text inside the agent UI, follow this document and
`opencollab/PROTOCOL_COMMANDS.md`; do not assume `/ocb` is a built-in shell
command.

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

Initialize or update workspace identity.

Required information:

- GitHub repo, for example `owner/project-repo`
- locked workspace/project name
- current actor id
- actor signature, usually 1-4 characters
- actor color, hex format

Agent behavior:

1. Read `Task_Status.json`.
2. Update `workspace.repo`, `workspace.name`, `workspace.currentActorId`, and `workspace.locked`.
3. Add or update the member record for the current actor.
4. Do not create a visible timeline node for identity-only changes.
5. Do not delete existing members or tasks.

Example intent:

```text
/ocb def repo=owner/project-repo workspace="Shared Literature Review" actor=mira signature=MI color=#65b8a6
```

### /ocb init

Initialize a task map from a task brief and cloud document address.

This replaces `/ocb run` as the primary command. `/ocb run` remains a
compatibility alias during the demo period.

Required information:

- task brief or assignment description
- cloud document, repo, or shared status URL
- optional member list

Agent behavior:

1. Read the first-read files.
2. Use Prompt A from `opencollab/PROMPTS.md`.
3. Identify final deliverable, audience, constraints, and known members.
4. Decompose work into task interfaces.
5. Use the I-TAC-C check to infer interdependence.
6. Write or update `Task_Status.json` with `tasks[]`, `links[]`, `categories[]`, `members[]`, and `view`.
7. Start the local visual system with `npm run dev`.
8. Tell the user to open `http://localhost:5173`.
9. Do not create a visible timeline node unless initialization itself records a project kickoff.

### /ocb run

Compatibility alias for `/ocb init`.

If the user says `/ocb run`, interpret it as:

```text
/ocb init using the current TTask_Status and Task_Status files
```

Do not keep `/ocb run` as the long-term user-facing name.

### /ocb pull

Pull the latest shared state from GitHub.

Agent behavior:

1. Use Prompt E from `opencollab/PROMPTS.md`.
2. Run `git pull --ff-only`.
3. If Git reports conflicts, stop and explain which files need resolution.
4. Re-read `opencollab/Task_Status.json`.
5. Do not create a visible timeline node for a clean pull.
6. Do not rewrite task ownership merely because a pull happened.

### /ocb push

Review today's local work, update `Task_Status.json`, check conflicts, then push.

Agent behavior:

1. Use Prompt F from `opencollab/PROMPTS.md`.
2. Pull the latest shared state first.
3. Inspect today's local work using Git, for example `git status`, `git diff`, and recently changed files.
4. Map local changes to task interfaces using `touches[]`, `interfaces.outputs`, and artifact paths.
5. For every touched task interface:
   - update `progress` from 0 to 100 using the best evidence from local work
   - set `state` to `active` when `progress` is above 0 and below 100
   - set `state` to `done` when `progress` is 100 and the task interface is ready for boundary review
   - keep `state` as `claimed` when ownership exists but `progress` is still 0
   - keep `state` as `undo` when the task is unclaimed and `progress` is 0
6. Update `touches`, `interfaces.outputs`, and `updatedAt` when evidence changed.
7. Recompute `links[]` only when the task interface contract changed.
8. Recompute `conflicts[]`.
9. Append exactly one visible `timeline` event of type `update`.
10. Save `Task_Status.json`.
11. Run `git add opencollab/Task_Status.json opencollab/AGENT.md opencollab/Task_Status.schema.json opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md opencollab/PROMPTS.md`.
12. Commit with a concise message.
13. Run `git push`.
14. Reload or tell the user to refresh the local visualization.

If push fails due to remote changes, run `/ocb pull`, re-read JSON, merge
intentionally, then retry.

### /ocb mtg

Add a manual meeting marker.

Agent behavior:

1. Use Prompt G from `opencollab/PROMPTS.md`.
2. Read `Task_Status.json`.
3. Create a `meetings[]` record with title, notes, selected task ids, and `createdAt`.
4. Append one visible `timeline` event of type `meeting`.
5. If a meeting explicitly resolves a conflict, mark that conflict resolved and name the decision.
6. Save `Task_Status.json`.

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

When claiming a task:

1. Set `claimantId` to the actor id.
2. Preserve `progress`.
3. Set `state` from `progress`: `claimed` at 0, `active` above 0, `done` at 100.
4. Do not append a visible timeline event; ordinary claims are reflected on the task node.

When marking work done:

1. Set `progress` to 100 and `state` to `done`.
2. Update `updatedAt`.
3. Add evidence to `interfaces.outputs`.
4. Check boundary links.

When adding a link:

1. Add a record to `links[]`.
2. Use `kind: "boundary"` by default.
3. Add `info` when the link captures a dependency, artifact coupling, or coordination contract.
4. Do not append a visible timeline event; links are shown through related task info on the board.

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
language summary can be short, but the structured result should be precise enough
for another agent to update `Task_Status.json` without guessing.
