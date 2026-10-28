/**
 * handoff.ts — global pi extension: session handoff management.
 *
 * Handoff files live in ~/handoffs/ and are NEVER deleted. Naming:
 *   <dirname>-<YYYY-MM-DD>-HANDOFF<n>.md   (dirname = hyphenated repo-root basename)
 * plus legacy layouts found in the wild: <dirname>-HANDOFF<n>.md and
 * repo-root HANDOFF<n>.md.
 *
 * Nothing is loaded automatically at startup. A handoff only enters the
 * session when the user explicitly loads it with /handoff read or restore.
 *
 * Commands:
 *   /handoff                interactive subcommand menu (like /pruner)
 *   /handoff write          write HANDOFF<n+1> via the publishing workflow
 *   /handoff list           list all documents, most recent last
 *   /handoff read <doc>     load the specified document (number, filename, path)
 *   /handoff restore        load the most recent document
 *   /handoff now            write, start a new session, load most recent
 *   /handoff help           show the help text
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename, sep } from "node:path";

type Handoff = {
  n: number;
  path: string;
  title: string;
  tasks: string;      // full "TASK LIST" section text
  opening: string;    // full "Suggested next-session opening" section text
};

type HandoffRef = { path: string; n: number; mtime: number };

const HANDOFF_DIR = join(homedir(), "handoffs");

// ── discovery ────────────────────────────────────────────────────────────

function repoRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return start; // no .git — treat start as root
    dir = parent;
  }
}

function hyphenated(s: string): string {
  return s.trim().replace(/\s+/g, "-");
}

/** All handoff refs visible from this repo (~/handoffs/ + repo root), oldest first. */
function collectHandoffs(cwd: string): HandoffRef[] {
  const root = repoRoot(cwd);

  const refs: HandoffRef[] = [];
  const consider = (path: string) => {
    const m = basename(path).match(/^(.*?)-?HANDOFF(\d+)(?:-\d+)?\.md$/);
    if (!m) return;
    refs.push({ path, n: Number(m[2]), mtime: statSync(path).mtimeMs });
  };

  try {
    for (const f of readdirSync(HANDOFF_DIR)) {
      if (f.endsWith(".md")) consider(join(HANDOFF_DIR, f));
    }
  } catch {
    /* no ~/handoffs dir */
  }
  if (root !== HANDOFF_DIR) {
    try {
      for (const f of readdirSync(root)) {
        if (f.endsWith(".md")) consider(join(root, f));
      }
    } catch {
      /* ignore */
    }
  }

  // ascending: most recent LAST (n, then mtime as tiebreak)
  refs.sort((a, b) => a.n - b.n || a.mtime - b.mtime);
  return refs;
}

/** Directory names handoff files may be named for: cwd basename + repo-root basename. */
function candidateNames(cwd: string): string[] {
  return [hyphenated(basename(cwd)), hyphenated(basename(repoRoot(cwd)))].filter(Boolean);
}

/** True if a handoff belongs to the current project: its name prefix matches a
 *  candidate dirname, or it's a legacy un-prefixed HANDOFF<n>.md in the repo root. */
function isScoped(path: string, cwd: string, candidates: string[]): boolean {
  const prefix = basename(path).match(/^(.*?)-?HANDOFF\d/)?.[1] ?? "";
  if (!prefix) return path.startsWith(repoRoot(cwd) + sep);
  return candidates.some((c) => prefix.startsWith(c));
}

/** Handoffs for the current project, oldest first. */
function scopedHandoffs(cwd: string): HandoffRef[] {
  const all = collectHandoffs(cwd);
  const candidates = candidateNames(cwd);
  return all.filter((r) => isScoped(r.path, cwd, candidates));
}


function parseHandoff(path: string): Handoff {
  const m = basename(path).match(/^(?:.*-)?HANDOFF(\d+)(?:-\d+)?\.md$/);
  const text = readFileSync(path, "utf8");
  const title = text.match(/^#\s+(.+)$/m)?.[1] ?? basename(path);
  const sections = text.split(/^## /m);
  const grab = (prefix: string): string =>
    sections.find((s) => s.startsWith(prefix))?.trim() ?? "";
  return {
    n: m ? Number(m[1]) : 0,
    path,
    title,
    tasks: grab("TASK LIST"),
    opening: grab("Suggested next-session opening"),
  };
}


/** Resolve a `read <doc>` argument: number ("9"), "handoff 9", filename substring, or path. */
function resolveDoc(refs: HandoffRef[], arg: string): HandoffRef | null {
  const a = arg.trim();
  if (!a) return null;
  const num = a.match(/^(?:handoff[-_ ]?)?(\d+)$/i);
  if (num) {
    const n = Number(num[1]);
    const matches = refs.filter((r) => r.n === n);
    return matches.length ? matches[matches.length - 1] : null;
  }
  const lower = a.toLowerCase();
  return refs.find((r) => r.path.toLowerCase().endsWith(lower))
    ?? refs.find((r) => basename(r.path).toLowerCase().includes(lower))
    ?? null;
}

// ── presentation ─────────────────────────────────────────────────────────

function taskHeadlines(tasks: string): string[] {
  return tasks
    .split("\n")
    .filter((l) => /^\d+\./.test(l.trim()))
    .map((l) => l.trim())
    .slice(0, 5);
}

function shortTitle(t: string, width = 72): string {
  return t.length > width ? `${t.slice(0, width - 1)}…` : t;
}
/** The "load" message: primes the agent with the handoff's task list + opening. */
function resumeMessage(h: Handoff): string {
  const heads = taskHeadlines(h.tasks);
  return [
    `Session resumed from ${h.path}.`,
    `Title: ${h.title}`,
    "",
    "TASK LIST (priority order):",
    heads.length ? heads.join("\n") : "(full task list in the handoff file)",
    "",
    h.opening ? `Suggested next-session opening section:\n${h.opening}` : "",
    "",
    "Begin your reply by presenting this task list briefly and suggesting the next step (the top open task). Do not re-derive state that the handoff already records.",
  ].join("\n");
}

// ── write flow text (used by /handoff write and /handoff now) ────────────

const WRITE_PROMPT = `Publish a session handoff for this repository (see schema/pipeline.md and existing handoffs in ~/handoffs/).

The goal: a new session must be able to resume WITHOUT this conversation. Explain how things work NOW, not the path that got here. Major changes get highlighted; mechanics get documented as current behavior.

Handoff files live in ~/handoffs/ (create the directory if needed) and are NEVER deleted. Naming: \`<dirname>-<YYYY-MM-DD>-HANDOFF<n+1>.md\`, where \`<dirname>\` is the hyphenated project directory name used by the existing handoffs (repo-root or working-directory basename - match the latest handoff's filename for consistency). Use today's date. If a file with that exact name already exists, append a \`-2\`, \`-3\`, ... suffix.

Steps:
1. **Find the latest handoff for this repo**: the most recent \`~/handoffs/*-HANDOFF<n>.md\` by the \`<n>\` in the name (also check the repo root for \`HANDOFF<n>.md\`; fall back to file date if numbering is unclear). Read it COMPLETELY — it defines the format conventions and the standing invariants you must carry forward.
2. **Reconstruct ground truth** (never trust the old handoff's numbers): run the repo's status tooling, \`git log --oneline -10\`, \`git status --short\`, and read the findings-ledger tail and current report if they exist.
3. **Clarify with the user if anything is ambiguous** — especially (a) what was decided this session and WHY, (b) which tasks are done vs still open, (c) new standing principles. If the session is straightforward, infer and proceed; state assumptions in the handoff.
4. **Write \`~/handoffs/<dirname>-<YYYY-MM-DD>-HANDOFF<n+1>.md\`** with these sections, in this order, matching the established format:
   - Title: \`HANDOFF <n+1> — <what changed; next: <next major work>>\`
   - Supersedes line: the path of the previous handoff (which remains in place, never deleted), canonical spec + findings-ledger range.
   - **Where the pipeline stands NOW**: exact status-tool output; what stages exist and have run; honest explanation of PENDING/DIRTY states; what is committed vs uncommitted.
   - **How things work NOW**: current mechanisms as reference documentation (scripts, config, artifacts, review surfaces). A new session reads THIS instead of re-deriving.
   - **The current program**: what we are doing and why — the active discussion's decisions, with evidence pointers (findings numbers, report sections).
   - **TASK LIST** (priority order). Each task self-contained: what to build/change, in which files, acceptance criteria, rough size/difficulty. Mark tasks that require the user present.
   - **DEFERRED QUEUE**: carryover items, marking any that are superseded.
   - **Standing invariants**: carry the previous list forward verbatim unless the user changed a rule; add new invariants this session established (numbered).
   - **Suggested next-session opening**: the exact expected status line(s) plus the first actions.
5. **Publish**: write the file, confirm the full path to the user. Do NOT delete any previous handoff. Do NOT commit anything — the handoff lives outside the repo. When the file is written, report its full path and STOP — do not start a new session or take further action; the /handoff now flow switches sessions itself.

Tone: dense, factual, no narration of session history beyond what it takes to explain current behavior.`;

// ── menu + help ──────────────────────────────────────────────────────────

const SUBCOMMANDS = [
  { value: "write",   label: "write    — write the handoff document (HANDOFF<n+1>)" },
  { value: "list",    label: "list     — list all documents, most recent last" },
  { value: "read",    label: "read     — load the specified document" },
  { value: "restore", label: "restore  — load the most recent document" },
  { value: "now",     label: "now      — write, start a new session, load the most recent" },
  { value: "help",    label: "help     — show this help" },
] as const;

const HELP_TEXT = `handoff — session handoff management (~/handoffs/, never deleted).

Usage:
  /handoff                  Interactive subcommand menu
  /handoff write            Write HANDOFF<n+1> via the publishing workflow
  /handoff list             List all documents, most recent last
  /handoff read <doc>       Load the specified document (number like 9, "handoff 9",
                            filename substring, or full path)
  /handoff restore          Load the most recent document
  /handoff now              Write the handoff, start a new session, and load it
  /handoff help             Show this help

Notes:
  Nothing is loaded at startup — a handoff enters the session only when
  you load it: /handoff restore (most recent for this repo) or /handoff read <doc>.
  /handoff now waits for the write to finish, verifies a new document exists,
  then switches sessions and loads it — no manual /new needed.`;

// ── extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let loadedPath: string | null = null;

  const loadInto = (h: Handoff): void => {
    loadedPath = h.path;
  };

  // Nothing is loaded at startup. A handoff enters the session only when the
  // user explicitly loads it (/handoff read, /handoff restore, /handoff now).
  pi.on("session_start", async (event) => {
    if (event.reason === "startup" || event.reason === "new") loadedPath = null;
  });

  pi.registerCommand("handoff", {
    description: "Session handoff management (write/list/read/restore/now)",
    getArgumentCompletions(prefix: string) {
      return SUBCOMMANDS.filter((s) => s.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      let sub = raw.split(/\s+/)[0]?.toLowerCase() || undefined;
      let subArgs = raw.split(/\s+/).slice(1).join(" ");

      // Bare /handoff → interactive picker, like /pruner
      if (!sub) {
        if (!(ctx.hasUI ?? true)) {
          ctx.ui.notify(HELP_TEXT, "info");
          return;
        }
        const choice = await ctx.ui.select("handoff — choose a subcommand",
          SUBCOMMANDS.map((s) => s.label));
        if (!choice) return;
        sub = choice.split(/\s+/)[0];
        subArgs = "";
      }

      const refs = () => collectHandoffs(ctx.cwd);
      const scoped = () => scopedHandoffs(ctx.cwd);

      switch (sub) {
        // ── /handoff write ──
        case "write":
        case "publish":
        case "new":
          pi.sendUserMessage(WRITE_PROMPT);
          return;

        // ── /handoff list ──
        case "list": {
          const all = refs();
          if (!all.length) {
            ctx.ui.notify(
              `No handoff documents in ~/handoffs/ or the repo root. Run /handoff write to create one.`,
              "warning",
            );
            return;
          }
          const mine = new Set(scoped().map((r) => r.path));
          const lines = [
            `handoff documents, oldest → newest (* = this project, → = loaded):`,
            ...all.map((r, i) => {
              const t = shortTitle(parseHandoff(r.path).title, 58);
              const proj = mine.has(r.path) ? "*" : " ";
              const loadMark = r.path === loadedPath ? "→" : " ";
              const newest = i === all.length - 1 ? "  ← most recent" : "";
              return `${proj}${loadMark} ${String(r.n).padStart(3)}  ${basename(r.path)}  —  ${t}${newest}`;
            }),
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        // ── /handoff read <document> ──
        case "read": {
          const all = refs();
          if (!all.length) {
            ctx.ui.notify(`No handoff documents found. Run /handoff write to create one.`, "warning");
            return;
          }
          let ref = resolveDoc(all, subArgs);
          if (!ref && (ctx.hasUI ?? true)) {
            // no/ambiguous argument → interactive document picker (most recent last)
            const choice = await ctx.ui.select(
              "handoff — load document (oldest → newest)",
              all.map((r) => `${r.n >= 10 ? "" : " "}${r.n}  ${basename(r.path)}  —  ${shortTitle(parseHandoff(r.path).title, 58)}`),
            );
            if (!choice) return;
            ref = resolveDoc(all, choice.split(/\s+/)[1] ?? choice) ?? all[all.length - 1];
          }
          if (!ref) {
            ctx.ui.notify(
              `No handoff matches "${subArgs}". Try a number (e.g. /handoff read 9), a filename substring, or /handoff list.`,
              "warning",
            );
            return;
          }
          const h = parseHandoff(ref.path);
          loadInto(h);
          pi.sendUserMessage(resumeMessage(h));
          return;
        }

        // ── /handoff restore ──
        case "restore": {
          const mine = scoped();
          const ref = mine[mine.length - 1];
          if (!ref) {
            ctx.ui.notify(`No handoff documents for this project. Run /handoff write to create one, or /handoff list to see documents from other projects.`, "warning");
            return;
          }
          const h = parseHandoff(ref.path);
          loadInto(h);
          pi.sendUserMessage(resumeMessage(h));
          return;
        }

        // ── /handoff now ──
        case "now": {
          const prevTop = scoped().reduce((m, r) => Math.max(m, r.n), 0);
          if (!ctx.isIdle()) await ctx.waitForIdle();
          pi.sendUserMessage(WRITE_PROMPT);
          await ctx.waitForIdle();

          const mine = scoped();
          const latest = mine[mine.length - 1];
          if (!latest || latest.n <= prevTop) {
            ctx.ui.notify(
              "No new handoff document was written — staying in this session. Check the agent's last reply, then try /handoff write.",
              "warning",
            );
            return;
          }

          const h = parseHandoff(latest.path);
          const parentSession = ctx.sessionManager.getSessionFile();
          await ctx.newSession({
            parentSession,
            withSession: async (nctx) => {
              // Deliver the load into the new session (nothing auto-loads).
              loadedPath = h.path;
              await nctx.sendUserMessage(resumeMessage(h));
            },
          });
          return;
        }

        // ── /handoff help ──
        case "help":
          ctx.ui.notify(HELP_TEXT, "info");
          return;

        default:
          ctx.ui.notify(`Unknown subcommand "${sub}". ${HELP_TEXT.split("\nUsage:")[1]?.split("\nNotes:")[0]?.trim() ?? ""}`, "warning");
          return;
      }
    },
  });
}
