# pi-handoffs

A [pi](https://pi.dev) extension for **session handoff management**: durable, numbered handoff documents that let any new session resume your work without the old conversation.

Handoff files live in `~/handoffs/` (plus repo roots) and are **never deleted** — they accumulate as a permanent record of how each project evolved. Nothing is loaded automatically at startup; a handoff enters the session only when you explicitly load it.

## Why handoffs instead of compaction

A handoff is a deliberate alternative to letting compaction summarize your session for you:

- **It takes the place of a compaction** — instead of a lossy machine summary, you get a document written on purpose, with the agent and user deciding what matters.
- **It keeps recent context in detail** — how things work *now*, exact status, what was decided this session and why — not a compressed approximation.
- **It lists issues and tasks in priority order**, so the moment a handoff is loaded into a fresh session you are ready to go at the top open task, not re-deriving state.
- **It serves as a work log** — numbered, dated, never deleted, so the documents accumulate into a permanent record of the project's evolution that any future session can consult.

## Commands

```
/handoff                  Interactive subcommand menu
/handoff write            Write HANDOFF<n+1> via the publishing workflow
/handoff list             List all documents, most recent last
/handoff read <doc>       Load the specified document (number, "handoff 9",
                          filename substring, or full path)
/handoff restore          Load the most recent document for this project
/handoff now              Write, start a new session, load the most recent
/handoff help             Show the help text
```

## How it works

- **`/handoff write`** sends the agent a structured publishing workflow: reconstruct ground truth (git status, latest handoff, findings), clarify open questions, then write `<dirname>-<YYYY-MM-DD>-HANDOFF<n+1>.md` with sections for current pipeline state, how things work now, the active program, a prioritized task list, deferred queue, and standing invariants.
- **`/handoff restore` / `read`** inject a resume message: the handoff's task list headlines plus the suggested next-session opening, so the new session picks up at the top open task instead of re-deriving state.
- **`/handoff now`** chains it all: wait for idle → write → verify a new document appeared → start a new session → load it. One command from "we're done here" to a primed fresh session.
- **Project scoping**: handoffs match by hyphenated directory name prefix, so `/handoff restore` and `list` know which documents belong to the repo you're in (`*` marks the current project, `→` marks the loaded one).

## How this differs from `pi-handoff`

[`pi-handoff`](https://github.com/default-anton/pi-handoff) generates a quick note from the current session and starts a new one. `pi-handoffs` treats handoffs as **permanent project documents**: numbered, dated, never deleted, format conventions carried forward from the previous handoff, with explicit task lists and invariants — designed for long-running projects that accumulate history across many sessions.

## Install

```bash
pi install npm:pi-handoffs
```

or from git:

```bash
pi install git:github.com/andrewprock/pi-handoffs
```

## License

MIT
