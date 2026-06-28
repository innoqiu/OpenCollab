# Task Interface Contracts

Each boundary contract should answer five questions:

1. What does this task own?
2. What does it consume from neighbor tasks?
3. What does it produce for neighbor tasks?
4. What must be stable before another person can safely build on it?
5. What evidence should `/OCB push` use to mark the task half-lit or lit?

Contract fields used by the demo:

- `name`: stable interface name.
- `method`: coordination style, such as `API`, `JSON schema`, `component props`, or `document section`.
- `path`: repository path or virtual endpoint.
- `request`: expected input shape.
- `response`: expected output shape.
- `boundaryNotes`: short AI notes for collaborators.

