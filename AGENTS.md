# OpenCollab Agent Entry

This repository uses OpenCollab. Treat `/ocb` and `/OCB` as protocol commands
typed by the user inside an agent conversation, not as native shell commands.

Before project work or any `/ocb` command, read these files in order:

1. `opencollab/AGENT.md`
2. `opencollab/PROTOCOL_COMMANDS.md`
3. `opencollab/Task_Status.json`
4. `opencollab/Task_Status.schema.json`
5. `opencollab/INTERDEPENDENCE_CONFLICT_FRAMEWORK.md`
6. `opencollab/PROMPTS.md`
7. `README.md`

The shared collaboration state is `opencollab/Task_Status.json`.

When the user types a protocol command:

- `/ocb init`: read the first-read files, initialize or refresh the task map,
  and start the local visual board.
- `/ocb pull`: pull the latest GitHub state, re-read `Task_Status.json`, and
  report any conflicts or changed task interfaces.
- `/ocb push`: review local work, update `Task_Status.json`, recompute
  conflicts, append one timeline update, commit, and push.
- `/ocb mtg`: add a meeting note to `meetings[]` and `timeline[]`.
- `/ocb def`: set the current workspace and actor identity.

Helper scripts such as `npm run ocb -- pull` may be used to perform mechanical
steps, but the agent remains responsible for reading the protocol, reviewing
work, and updating the JSON intentionally.
