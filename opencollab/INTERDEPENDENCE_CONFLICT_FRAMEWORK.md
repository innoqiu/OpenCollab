# OpenCollab Interdependence and Conflict Framework

This framework is domain-general. It should work for writing projects, software
projects, research tasks, presentations, design work, data work, and mixed team
assignments.

## Task Interface

A task interface is the smallest ownable work unit that can be claimed, updated,
reviewed, and handed off without hiding another claimable task inside it.

A good task interface has:

- `owner surface`: what artifact, decision, or claim the task owns.
- `inputs`: what it consumes from earlier or neighboring tasks.
- `outputs`: what other tasks can safely reuse.
- `boundary notes`: what must remain stable before another task builds on it.
- `evidence`: what files, notes, records, or decisions prove progress.

## Interdependence

Interdependence exists when one task can change the correctness, timing, scope,
or usability of another task.

Not every relationship is a conflict. Interdependence is the coordination map;
conflict is a risky state on that map.

### The I-TAC-C Check

Use this check to find interdependence between any two tasks:

- `Input`: Does task B require an output from task A?
- `Timing`: Does one task need to finish, freeze, or review before another proceeds?
- `Artifact`: Do the tasks touch the same file, dataset, component, paragraph, claim, or decision?
- `Contract`: Do they need the same schema, vocabulary, API, rubric, tone, standard, or acceptance rule?
- `Claim`: Could both tasks make overlapping or contradictory claims about the same thing?

If at least one answer is yes, create or update a `links[]` record.

### Link Types

Use only the link types the visual system understands:

- `dependency`: source is a prerequisite for target.
- `boundary`: tasks can proceed separately, but must align a shared artifact, claim, wording, schema, or decision.
- `sync`: active tasks need a short coordination meeting before either side can safely continue.

### Direction Rule

For `dependency`, `source` is the prerequisite and `target` is the downstream task.

For `boundary` and `sync`, direction is less important, but keep the earlier or
more contract-like task as `source` when possible.

### Interdependence Output Standard

Every interdependence should be readable as a small coordination contract:

```json
{
  "id": "ln-##",
  "source": "TASK-01",
  "target": "TASK-02",
  "kind": "dependency | boundary | sync",
  "info": "TASK-02 depends on TASK-01 because ... Coordinate X with Y before ...",
  "createdBy": "agent-or-member-id",
  "createdAt": "ISO timestamp"
}
```

Good `info` text names:

- the shared interface,
- why the connection matters,
- what must be coordinated,
- what should not be finalized before coordination.

## Conflict

A conflict exists when current claims, progress, files, assumptions, or task
states cannot all be safely merged without coordination.

Conflict is not blame. It is an actionable signal that the interdependence map
has become risky.

### Conflict Triggers

OpenCollab currently records four general conflict types:

- `boundary-sync`: two active tasks on a boundary/sync link are owned by different people and need alignment.
- `shared-file`: two active tasks owned by different people touch the same artifact.
- `dependency-not-done`: a downstream task is done while a prerequisite is below 100%.
- `double-claim`: two people attempted to own the same task in the same synchronization window.

### Conflict Severity

Use this severity guide:

- `low`: potential confusion, but no current merge or finalization risk.
- `medium`: active work can diverge unless people sync soon.
- `high`: final output, data contract, ownership, or merge correctness is at risk now.

### Conflict Output Standard

```json
{
  "id": "stable-conflict-id",
  "type": "boundary-sync | shared-file | dependency-not-done | double-claim",
  "severity": "low | medium | high",
  "taskIds": ["TASK-01", "TASK-02"],
  "memberIds": ["member-a", "member-b"],
  "title": "Short actionable title",
  "message": "Concrete explanation and next action.",
  "detectedAt": "ISO timestamp",
  "resolved": false
}
```

### Resolution Rule

A conflict is resolved only when the agent can point to evidence:

- a meeting note,
- a committed artifact change,
- a revised link contract,
- a changed owner,
- a changed progress state,
- or an explicit decision recorded in `timeline[]` or `meetings[]`.

Do not delete a conflict just because it is inconvenient. Mark it resolved only
when the current JSON state and repository evidence support resolution.
