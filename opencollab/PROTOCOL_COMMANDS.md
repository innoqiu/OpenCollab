# OpenCollab Protocol Commands

`/ocb` is a protocol command for local agents. It is intentionally simple:
users type it in Codex, Claude Code, or another repo-aware agent; the agent
reads this repository's OpenCollab documents and performs the workflow.

`/ocb` is case-insensitive. Treat `/OCB push` and `/ocb push` the same way.

## Principle

The command is not the product. The shared state is:

```text
opencollab/Task_Status.json
```

The agent's job is to keep that file aligned with real work, GitHub state, and
the local visual board.

## First-Run Contract

When an agent sees `/ocb` for the first time in a repository:

1. Read `AGENTS.md` or `CLAUDE.md` if present.
2. Read `opencollab/AGENT.md`.
3. Read `opencollab/Task_Status.json`.
4. Read `opencollab/Task_Status.schema.json`.
5. Read `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`.
6. Read `opencollab/PROMPTS.md`.
7. Confirm the current actor if `workspace.currentActorId` is missing or wrong.

Do not invent a new project protocol if these files exist.

## Command Grammar

```text
/ocb <action> [free text details]
```

Supported actions:

- `def`: define workspace and actor identity.
- `init`: initialize or refresh the task interface map and open the board.
- `run`: compatibility alias for `init`.
- `pull`: pull GitHub state and re-read OpenCollab status.
- `push`: review local work, update status, commit, and push.
- `mtg`: add a meeting note.
- `help`: summarize available protocol commands.

## /ocb init

Use when starting the visual board or generating the first task map.

Agent steps:

1. Read the first-run contract files.
2. If `opencollab/Task_Status.json` exists, preserve stable task ids and board
   positions unless the user asks for a rebuild.
3. If only a brief exists, decompose it into task interfaces.
4. Infer interdependence with the I-TAC-C check from the framework document.
5. Save `Task_Status.json`.
6. Start the local board with `npm run dev` when the project has the OpenCollab
   Vite app.
7. Tell the user the local URL.

## /ocb pull

Use when a teammate may have pushed updates.

Agent steps:

1. Check whether local work is dirty.
2. Run `git pull --ff-only`.
3. If Git cannot fast-forward, stop and explain the conflict.
4. Re-read `Task_Status.json`.
5. Summarize changed claims, progress, conflicts, and meeting notes.
6. Do not create a visible timeline event for a clean pull.

## /ocb push

Use when the user finished local work and wants to publish task progress.

Agent steps:

1. Pull first unless local Git state would make that unsafe.
2. Inspect local changes with Git and recently modified files.
3. Map changed artifacts to task interfaces through `touches[]`,
   `interfaces.inputs`, and `interfaces.outputs`.
4. Update task state and progress using evidence from the actual work.
5. Recompute conflicts from active interdependence and shared touched files.
6. Append exactly one visible `timeline[]` event of type `update`.
7. Validate or at least sanity-check `Task_Status.json`.
8. Commit the changed project files.
9. Push to GitHub.
10. Tell the user what changed and whether any conflicts need attention.

The helper script may be used for mechanical pieces:

```bash
npm run ocb -- push
```

The helper does not replace the agent's review. A good `/ocb push` always
contains human-readable reasoning about what task interfaces were affected.

## /ocb mtg

Use when a meeting, handoff, or boundary decision should be recorded.

Agent steps:

1. Ask for a title and notes if they are missing.
2. Identify related task ids.
3. Add a `meetings[]` record.
4. Add one `timeline[]` event of type `meeting`.
5. If a conflict is resolved, mark it resolved and describe the decision.

## /ocb def

Use when setting up a project member or actor identity.

Agent steps:

1. Set `workspace.repo`, `workspace.name`, and `workspace.currentActorId`.
2. Add or update the matching member record.
3. Preserve existing tasks, claims, meetings, and conflicts.
4. Do not add a visible timeline event for identity-only changes.

## Installing The Entry In Another Repo

For a new OpenCollab project, copy these files into the target repository:

```text
AGENTS.md
CLAUDE.md
.claude/commands/ocb.md
opencollab/AGENT.md
opencollab/PROTOCOL_COMMANDS.md
opencollab/Task_Status.json
opencollab/Task_Status.schema.json
opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md
opencollab/PROMPTS.md
```

Then open the target repository in the agent and type:

```text
/ocb init
```
