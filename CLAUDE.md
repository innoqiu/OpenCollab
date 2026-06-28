# OpenCollab Claude Entry

This is the OpenCollab tool repo. The target task repo is configured locally and
stores the lightweight JSON dataset.

Read these files before acting on `/ocb`:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`

`/ocb` is a protocol command typed in Claude Code. It is not a shell command.
Use `npm run ocb -- <action>` only as a helper for mechanical steps.

For normal collaboration, read and write the configured target repo's
`opencollab/Task_Status.json`. Do not commit or push this OpenCollab tool repo
unless the user explicitly asks to modify the tool itself.
