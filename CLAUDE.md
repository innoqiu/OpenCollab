# OpenCollab Claude Entry

This is an OpenCollab repository. `/ocb` is a protocol command that the user
types inside Claude Code; it is not a standalone shell slash command.

Read these files before acting on `/ocb`:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.json`
4. `opencollab/Task_Status.schema.json`
5. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
6. `opencollab/PROMPTS.md`

Use `opencollab/Task_Status.json` as the source of truth for task claims,
progress, interdependence, conflicts, meetings, and timeline events.

If Claude receives `/ocb init`, `/ocb pull`, `/ocb push`, `/ocb mtg`, or
`/ocb def`, follow `opencollab/PROTOCOL_COMMANDS.md` and
`opencollab/AGENT.md`. The helper script `npm run ocb -- <command>` can be used
for mechanical Git or local-service steps, but Claude should still review the
work and update `Task_Status.json` deliberately.
