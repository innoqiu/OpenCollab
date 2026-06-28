# OpenCollab Structured Prompt Library

These prompts are written for local coding or writing agents that can read files,
inspect Git state, edit `opencollab/Task_Status.json`, and run the OpenCollab
local visual system.

All prompts assume the agent has first read:

1. `AGENTS.md` or `CLAUDE.md` when present
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/TTask_Status.json`
4. `opencollab/Task_Status.json`
5. `opencollab/Task_Status.schema.json`
6. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
7. `opencollab/PROMPTS.md`
8. `opencollab/AGENT.md`
9. `README.md`

## Prompt A: `/ocb init`

Use when the user defines a task and a cloud document or repository address.

```text
You are initializing an OpenCollab project.

Inputs:
- user task brief: {{TASK_BRIEF}}
- cloud document or repo URL: {{CLOUD_DOC_URL}}
- local status target: opencollab/Task_Status.json

Read the task brief and any existing Task_Status. Create or update a local-first
task interface map.

Steps:
1. Identify the final deliverable and audience.
2. Decompose work into minimal task interfaces.
3. Assign categories and a board layout.
4. Infer interdependence using the I-TAC-C check.
5. Create dependency, boundary, and sync links with readable `info`.
6. Initialize four-person or provided-team membership if members are known.
7. Create initial conflicts only when the current state is already risky.
8. Write a valid Task_Status JSON and start the visual system.

Return this structured summary:
{
  "command": "/ocb init",
  "cloudDocument": "string",
  "project": {
    "name": "string",
    "finalDeliverable": "string",
    "audience": "string"
  },
  "taskInterfaces": [
    {
      "id": "string",
      "title": "string",
      "category": "string",
      "ownerSuggestion": "member-id-or-null",
      "inputs": ["string"],
      "outputs": ["string"],
      "evidence": ["path-or-artifact"],
      "minimumUnitReason": "string"
    }
  ],
  "interdependence": [
    {
      "source": "task-id",
      "target": "task-id",
      "kind": "dependency | boundary | sync",
      "coordinationContract": "string",
      "whyItMatters": "string"
    }
  ],
  "initialConflicts": [
    {
      "type": "boundary-sync | shared-file | dependency-not-done | double-claim",
      "severity": "low | medium | high",
      "taskIds": ["task-id"],
      "memberIds": ["member-id"],
      "nextAction": "string"
    }
  ],
  "filesWritten": ["opencollab/Task_Status.json"],
  "visualization": {
    "localUrl": "http://localhost:5173",
    "status": "started | not-started",
    "reasonIfNotStarted": "string-or-null"
  }
}
```

## Prompt B: Task Decomposition

Use inside `/ocb init` or when a brief has changed substantially.

```text
Decompose this work into task interfaces.

A valid task interface:
- has one clear owner surface,
- produces one inspectable output,
- does not hide a second claimable task,
- names inputs and outputs,
- names evidence that proves progress.

For each candidate, reject tasks that are too broad, overlapping, or only a vague
activity. Split or rename them until each task can be claimed by one person.

Output:
{
  "accepted": [
    {
      "title": "string",
      "category": "string",
      "ownableSurface": "string",
      "inputs": ["string"],
      "outputs": ["string"],
      "evidence": ["string"],
      "tooBroadRisk": "string",
      "minimumUnitReason": "string"
    }
  ],
  "rejectedOrSplit": [
    {
      "candidate": "string",
      "reason": "too broad | overlaps | unclear output | not claimable",
      "replacementTasks": ["string"]
    }
  ]
}
```

## Prompt C: Interdependence Analysis

Use after task interfaces exist.

```text
Analyze interdependence among these tasks using the I-TAC-C check:
Input, Timing, Artifact, Contract, Claim.

For every pair with meaningful coupling, create a readable coordination contract.
Do not draw links merely because tasks are in the same category.

Output:
{
  "links": [
    {
      "source": "task-id",
      "target": "task-id",
      "kind": "dependency | boundary | sync",
      "itaccSignals": {
        "input": true,
        "timing": false,
        "artifact": true,
        "contract": true,
        "claim": false
      },
      "interface": "shared file, schema, concept, claim, component, dataset, rubric, or decision",
      "info": "human-readable coordination contract",
      "recommendedOwnerAction": "claim | sync | wait | proceed | review"
    }
  ],
  "omittedPairs": [
    {
      "pair": ["task-id", "task-id"],
      "reason": "same category only | no shared output | no timing dependency"
    }
  ]
}
```

## Prompt D: Conflict Analysis

Use during `/ocb push`, after local changes are mapped into tasks, and after
pulling the latest shared JSON.

```text
Detect conflicts in the current OpenCollab state.

Use the conflict framework:
- boundary-sync
- shared-file
- dependency-not-done
- double-claim

Only create a conflict if there is current risk. Explain the action that would
resolve it.

Output:
{
  "conflicts": [
    {
      "id": "stable-id",
      "type": "boundary-sync | shared-file | dependency-not-done | double-claim",
      "severity": "low | medium | high",
      "taskIds": ["task-id"],
      "memberIds": ["member-id"],
      "title": "short title",
      "message": "specific explanation",
      "evidence": ["file path, link id, task state, or meeting id"],
      "nextAction": "specific sync, edit, owner change, or review step",
      "resolved": false
    }
  ],
  "nonConflictingInterdependence": [
    {
      "linkId": "string",
      "reason": "why this link is safe right now"
    }
  ]
}
```

## Prompt E: `/ocb pull`

Use when synchronizing from GitHub.

```text
Pull the latest shared OpenCollab JSON.

Steps:
1. Run `git pull --ff-only`.
2. If Git reports conflicts, stop and report the files.
3. Re-read Task_Status.
4. Validate that members, tasks, links, progress, meetings, and conflicts render.
5. Do not rewrite ownership or progress merely because a pull happened.

Output:
{
  "command": "/ocb pull",
  "git": {
    "status": "clean | pulled | conflict | failed",
    "message": "string"
  },
  "statusSummary": {
    "tasks": 0,
    "links": 0,
    "members": 0,
    "unresolvedConflicts": 0
  },
  "nextRecommendedAction": "string"
}
```

## Prompt F: `/ocb push`

Use after a user has worked locally with an agent or edited project files.

```text
Push the current user's OpenCollab update.

Steps:
1. Pull latest shared state first using `/ocb pull` behavior.
2. Inspect local Git changes and recently edited files.
3. Map file changes to task interfaces by `touches[]` and interface outputs.
4. Update only tasks supported by evidence.
5. Preserve other users' claims unless a confirmed replacement happened.
6. Recompute interdependence-derived conflicts.
7. Append one timeline update describing the local work and remaining risks.
8. Save Task_Status, commit, and push.
9. Reload the visual UI from the latest JSON.

Output:
{
  "command": "/ocb push",
  "actorId": "member-id",
  "pulledBeforePush": true,
  "localEvidence": [
    {
      "path": "string",
      "changeType": "created | edited | deleted | renamed",
      "mappedTaskIds": ["task-id"],
      "confidence": "low | medium | high"
    }
  ],
  "taskUpdates": [
    {
      "taskId": "string",
      "previousProgress": 0,
      "nextProgress": 0,
      "state": "undo | claimed | active | done",
      "outputsAdded": ["string"],
      "reason": "string"
    }
  ],
  "conflicts": [
    {
      "id": "string",
      "severity": "low | medium | high",
      "nextAction": "string"
    }
  ],
  "timelineEvent": {
    "title": "string",
    "details": "string",
    "taskIds": ["task-id"]
  },
  "git": {
    "commit": "string-or-null",
    "pushStatus": "pushed | auth-needed | conflict | failed"
  },
  "visualization": {
    "reloaded": true,
    "localUrl": "http://localhost:5173"
  }
}
```

## Prompt G: Meeting Note

Use when the user records a meeting from the visual system or `/ocb mtg`.

```text
Convert this meeting note into structured OpenCollab updates.

Rules:
- Preserve the user's wording in `notes`.
- Link task ids mentioned by the user.
- If the meeting resolves a conflict, mark the conflict resolved only when the
  decision is explicit.
- If the meeting creates new work, prefer a new task interface or link rather
  than hiding the work inside the meeting text.

Output:
{
  "meeting": {
    "title": "string",
    "notes": "string",
    "taskIds": ["task-id"]
  },
  "resolvedConflicts": ["conflict-id"],
  "newLinks": [
    {
      "source": "task-id",
      "target": "task-id",
      "kind": "dependency | boundary | sync",
      "info": "string"
    }
  ],
  "newTaskCandidates": [
    {
      "title": "string",
      "reason": "string"
    }
  ]
}
```
