# OpenCollab Claude Entry

This is the OpenCollab tool repo. The parent repo owns the local visualizer and
protocol; each collaboration project lives in its own folder under `tasks/`.

Read these files before acting on `/ocb`:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.schema.json`
4. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
5. `opencollab/PROMPTS.md`

`/ocb` is a protocol command typed in Claude Code. It is not a shell command.
Use `npm run ocb -- <action>` only as a helper for mechanical steps.

The normal flow is:

```bash
npm run ocb -- init https://github.com/<owner>/<task-repo>.git
npm run ocb -- list
npm run ocb -- use <project-id>
npm run ocb -- run
```

For collaboration work, read and write the current task folder's
`opencollab/Task_Status.json`. Do not commit or push this OpenCollab tool repo
unless the user explicitly asks to modify the tool itself.

If Claude starts inside a task folder, read that folder's generated `CLAUDE.md`
or `AGENTS.md`; it points back to this parent protocol and tells Claude which
task project is current.
