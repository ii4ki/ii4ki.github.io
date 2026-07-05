---
title: Hooks to the Rescue
description: "Claude Code hooks explained — from the stdin/stdout contract to practical scripts that keep orphaned AI processes from eating your RAM."
pubDate: 2026-05-20
tags: [ai, efficiency, beginner]
draft: false
---

`@rkesteva` [posted a screenshot](https://www.threads.com/@rkesteva/post/DYXafupG09v) on Threads that stopped me mid-scroll: his MacBook's Force Quit window, Warp terminal consuming 38+ GB of RAM, Google Chrome eating another 48 — on a machine with 16 GB. Every app paused or not responding. In the comments he [clarified](https://www.threads.com/@rkesteva/post/DYXgX14FJFq): "Ironically Claude wasn't even using Playwright when this happened. Something in the Playwright + Warp agent loop went very wrong." He was only personally responsible for about 10 GB; the rest was Playwright, left running long after the session it was needed for.

I've been there. A self-hosted Whisper model once ate 70+ GB on my machine and froze it completely.

The pattern is the same regardless of which AI tool you're using: agents spin up services to do their work, and when the session ends, those services keep running. Silently. Indefinitely. Until the machine grinds to a halt. Cursor, Codex, Warp, Claude Code — the process leak problem is [documented across all of them](https://github.com/openai/codex/issues/17832). Buying more RAM is not the answer. They'll fill whatever you give them.

Claude Code happens to have the most mature session hook system among CLI AI tools right now, so that's what I'll use for the examples here. But the underlying problem — and the system-level workaround for tools that don't have hooks — applies to everything.

## What Hooks Actually Are

A hook (in the context of AI tools) is a shell command — or an HTTP call, or an LLM prompt — that Claude Code executes at specific lifecycle points: session start, session end, before a tool call, after a turn completes. Triggers wired into Claude's operating loop.

The distinction that matters: **hooks are deterministic, not advisory.** A rule in CLAUDE.md says "please don't." A `PreToolUse` hook with exit code 2 says "you physically cannot." Claude receives your error message and stops. That's a different class of control.

### The stdin/stdout contract

Every hook receives a JSON blob on stdin describing the current event:

```json
{
  "session_id": "...",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/your/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf foo" }
}
```

Your script reads that, makes a decision, and communicates back through exit codes:

- **Exit 0** — proceed normally. Optionally print JSON to stdout to pass context to Claude.
- **Exit 2** — block this action. Claude reads your stderr as the reason and stops.
- **Any other exit** — non-blocking warning. Execution continues.

Session-level hooks (`SessionStart`, `SessionEnd`) don't need to parse any of this — there's no tool call to allow or block, just a command to run. Anything on `PreToolUse` needs `jq` to parse stdin properly, or it'll interrupt every tool call.

### Hook events

Events fall into three cadences: once per session, once per turn, and on every tool call.

| Event                            | When it fires                       |
| -------------------------------- | ----------------------------------- |
| `SessionStart`                   | Session begins or resumes           |
| `SessionEnd`                     | Session terminates                  |
| `UserPromptSubmit`               | Before Claude processes your prompt |
| `PreToolUse`                     | Before a tool call — can block it   |
| `PostToolUse`                    | After a tool call succeeds          |
| `Stop`                           | When Claude finishes a turn         |
| `StopFailure`                    | When a turn ends due to API error   |
| `PreCompact` / `PostCompact`     | Around context compaction           |
| `SubagentStart` / `SubagentStop` | When subagents spawn or finish      |

One more thing worth knowing upfront: hooks can be set at two levels. **Global hooks** in `~/.claude/settings.json` apply to every Claude Code session on your machine — resource management and MCP cleanup belong here. **Project-level hooks** in `.claude/settings.json` apply only within that project — useful for enforcing code style, protecting specific files, or project-specific safety rules. I've got [one of those](https://ii4ki.github.io/blog/2026-07-05-your-markdown-has-a-stutter/) worth reading: a `PostToolUse` hook that fixes the hard-wrapped Markdown Claude Code keeps writing into your files.

## The MCP Orphan Problem

MCP servers are the most common source of runaway AI processes. Here's what actually happens:

1. Claude Code spawns MCP servers as child processes at session start.
2. `npx`-based servers are direct children — on graceful exit, they usually get `SIGTERM`.
3. Docker-based servers are worse: Claude kills the `docker run` wrapper, but the container keeps running under the Docker daemon. It outlives the session entirely.
4. On crash or `SIGKILL`: nothing gets cleaned up at all.

The services most likely to cause problems are the heavyweight ones — browsers, containers, memory indexers — that agents spin up for a task and never explicitly close:

- **Playwright MCP** — spins up a full Chromium instance. Each orphaned session leaves a browser process running and fans spinning.
- **Chrome DevTools MCP** — Node process plus Chrome, neither cleaned up on exit.
- **Context7, mcp-memory-service, and most `npx`-based servers** — direct children that Claude Code fails to SIGTERM on graceful exit, and abandons entirely on crash.
- **Docker-based MCPs** — container outlives the session, always.

Cloud-hosted MCPs — Anthropic-managed Gmail, Calendar, Drive integrations, IDE plugins — don't have this problem. They don't spawn local processes and have nothing to orphan.

## The Six Hooks I Installed

Everything lives in `~/.claude/settings.json` and a few scripts in `~/.claude/hooks/`.

### 1. RAM snapshot on SessionStart, Stop, and PreCompact

Before you can know whether Claude Code is leaking memory on your machine, you need a baseline — and a way to compare before and after each session. This script runs silently and appends to `~/.claude_resource.log`:

```bash
#!/bin/bash
# ~/.claude/hooks/mem-log.sh
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
PAGES=$(vm_stat | grep 'Pages active' | awk '{print $3}' | tr -d '.')
FREE=$(vm_stat | grep 'Pages free' | awk '{print $3}' | tr -d '.')
echo "$TIMESTAMP event=$1 active_pages=$PAGES free_pages=$FREE" >> ~/.claude_resource.log
```

On Apple Silicon, each page is 16KB — so `active_pages * 16 / 1024` gives you MB. The signal to watch: if active pages at `Stop` keep trending higher than at `SessionStart` across multiple sessions, you have a leak. The `PreCompact` entries let you correlate context compaction events with memory spikes.

The log is also something you can hand to Claude directly — pull it up, ask which sessions consumed the most RAM, and use that to tune your setup over time.

After a few days of sessions, here's what mine actually looks like:

```
2026-05-16 23:30:39 event=SessionStart active=277530 free=4854
2026-05-16 23:31:46 event=Stop        active=278397 free=8215
2026-05-16 23:36:02 event=SessionStart active=288944 free=14554
2026-05-16 23:36:10 event=Stop        active=292360 free=8850
2026-05-17 09:35:25 event=SessionStart active=299928 free=3525
2026-05-17 10:07:42 event=Stop        active=292781 free=7885
```

Active pages hovering between 277k–300k translates to roughly 4.3–4.7 GB of active memory system-wide. Per-session bumps are 1,000–4,000 pages (16–64 MB). No meaningful accumulation between sessions — which is expected, because my current MCP stack is all cloud-hosted. None of those sessions involved local MCP servers.

That's the baseline. Then I ran a session with Chrome DevTools MCP active:

```
2026-05-17 12:00:45 event=SessionStart active=273139 free=3723
2026-05-17 12:02:40 event=Stop        active=226119 free=17828
```

Active pages dropped by 47,000 between `SessionStart` and `Stop` — roughly 735 MB freed when the session ended cleanly. That's 10–45× the per-session delta from the cloud-only sessions above. The drop happens because the `SessionEnd` hook fires and `pkill` kills the Chrome and Node processes that Chrome DevTools MCP spawned. Without the hook, those processes keep running and that 735 MB stays resident until you kill them manually or reboot.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/mem-log.sh SessionStart"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "~/.claude/hooks/mem-log.sh Stop" }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/mem-log.sh PreCompact"
          }
        ]
      }
    ]
  }
}
```

### 2. MCP cleanup on SessionEnd

The most directly useful hook for the orphan problem. Kills local MCP processes when Claude Code exits cleanly:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pkill -f 'npx.*mcp' || true"
          }
        ]
      }
    ]
  }
}
```

It's a blunt instrument — catches anything with "mcp" in the process command. A more precise version would track PIDs in a file during `SessionStart` and kill only those. For most setups the blunt version is fine.

One thing worth knowing about how `pkill` works here: it's a system-wide kill, not a session-scoped one. It matches against every running process on the machine regardless of which session spawned it. So if Session A crashes and leaves an orphaned MCP process behind, Session B — even one that never touched an MCP at all — will sweep it up when it exits cleanly. The hook is a recurring janitor, not just a session cleanup.

The actual limitation is narrower than it first appears: the hook only runs when _some_ session exits gracefully. In practice that almost always happens eventually, so orphans are "eventually cleaned" rather than permanent. The exception is Docker-based MCPs — `pkill -f 'npx.*mcp'` kills the `docker run` wrapper, but the container itself keeps running under the Docker daemon. Those need explicit `docker stop`, which requires knowing the container ID — a separate piece worth its own script.

For full crash resilience on either type, you'd need a `launchd` watchdog: a plist that runs every 60 seconds, checks if Claude is running, and kills stale processes if not. That approach works regardless of how the session ended. We'll cover it in a future post.

### 3. Desktop notification on Stop

```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "osascript -e 'display notification \"Claude finished\" with title \"Claude Code\"'"
  }]
}]
```

Tab away during long tasks and actually do something else. One line.

### 4. StopFailure notification

```json
"StopFailure": [{
  "hooks": [{
    "type": "command",
    "command": "osascript -e 'display notification \"Turn failed (API error)\" with title \"Claude Code\"'"
  }]
}]
```

This one earns its place more than the `Stop` notification does. Without it, an API error mid-session fails silently while you're tabbed away. You come back, nothing happened, and you don't know why. The `StopFailure` hook makes that failure loud immediately. Low noise — only fires on actual failures — high signal.

### 5. Block dangerous rm patterns on PreToolUse

Running Claude Code with full permissions and no supervision means it can technically execute `rm -rf /` — nuke the root filesystem. The chances are slim, but the outcome is permanent and irreversible. This hook catches the obvious patterns before they reach the shell:

```bash
#!/bin/bash
# ~/.claude/hooks/block-dangerous.sh
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$CMD" | grep -qE '(rm -rf|rm -r /|sudo rm)'; then
  echo "Blocked: destructive rm pattern. Run manually if intentional." >&2
  exit 2
fi
exit 0
```

```json
"PreToolUse": [{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "~/.claude/hooks/block-dangerous.sh"
  }]
}]
```

The script fires on every Bash tool call, reads the command from stdin, and blocks on match. Exit 2 stops Claude cold — it receives your stderr message and cannot proceed. Normal `rm` operations (`rm somefile.txt`, `rm -rf ./node_modules`) pass through untouched.

If you're manually approving every Claude command, this hook adds a second layer over one that's already there — the built-in permission system catches most of this in interactive mode. The hook shows its real value when you run agents unsupervised: if you spin up a subagent on a long task and step away, you no longer have eyes on every tool call. The hook runs automatically. It won't catch clever variable-based evasion, but it catches the obvious patterns — which are the most dangerous ones. Low effort to set up, near-zero runtime overhead, no ongoing maintenance.

### 6. PreCompact RAM log

The same `mem-log.sh` script hooked to `PreCompact`. Gives you a reading at the moment Claude Code decides context is getting full, letting you correlate compaction events with memory pressure in the log. Rounds out the picture alongside `SessionStart` and `Stop` readings.

## What to Watch For

Hooks cover graceful exits and expected tool calls. They don't cover crashes. They don't cover clever command wrapping. And `PreToolUse` hooks run on every single Bash call — keep those scripts fast or you'll add latency to every `ls` and `git status`.

The more useful framing: work through your own setup by asking which MCPs you actually run (`npx`-based, Docker-based, or cloud-hosted), which hook events match your workflow, and what you're actually defending against. The scripts here are a starting point, not a one-size-fits-all config. Do a back-and-forth with Claude to map your specific setup before you wire anything up.

If you want to go deeper on stress-testing your configuration, there's a [pressure-test skill](https://github.com/bitcoin21ideas/skills/tree/main/skills/pressure-test) for exactly that.

## What About Other Tools?

The hook system described above is Claude Code-specific, but the MCP orphan problem isn't. Here's where other popular tools stand:

**Cursor** — same process leak bug, multiple open reports, no built-in lifecycle hook system. The workaround is the same `pkill -f 'npx.*mcp'` command, but you have to run it manually or wire it into a `launchd` watchdog on macOS (or `systemd` timer on Linux) since there's nothing equivalent to `SessionEnd` to trigger it automatically.

**OpenAI Codex CLI** — Playwright MCP leak is [documented in issue #17832](https://github.com/openai/codex/issues/17832): 213 orphaned process pairs, 13.6 GB RSS after a normal session. No built-in hook system. Same system-level watchdog approach applies.

**GitHub Copilot CLI** — actually has session lifecycle hooks, configured in `.github/hooks/*.json`. The `sessionEnd` event is supported, which means you can wire up the same MCP cleanup command there. Closest to Claude Code's approach.

**Warp** — the tool in `@rkesteva`'s screenshot. When used as a terminal manager with its agent features, it can leave Playwright and similar processes running after the agent loop ends. No built-in hook system for session cleanup. Use a `launchd` watchdog.

**Windsurf** — has a "Cascade Hooks" feature for intercepting user prompts, but these are input filters rather than session lifecycle events. No `SessionEnd` equivalent. Has fixed some orphan process issues in recent releases. System-level watchdog for MCP cleanup.

For any tool without a native hook system, the universal fallback is a `launchd` plist (macOS) or `systemd` timer (Linux) that runs every 60 seconds, checks if the AI tool is still running, and kills stale MCP processes if it isn't. That approach works regardless of whether the session ended gracefully or crashed. We'll cover that in a future post.

## The Gist

Hooks are deterministic guardrails. Not suggestions, not CLAUDE.md rules that ask politely — actual blockers with physical consequences. A `PreToolUse` hook with exit 2 prevents the tool call. That's the frame everything else sits in.

The setup:

- **RAM logger** at session boundaries — visibility into what Claude Code leaves behind
- **MCP cleanup** on graceful exit — kills orphaned local server processes
- **Stop + StopFailure notifications** — know when Claude finishes or fails without watching the terminal
- **rm blocker** on PreToolUse — automatic safety net for unsupervised agent work

Four shell scripts and a JSON config. Under an hour to install.

Hook setup is individual. Which MCPs you run, which AI tools you use, and how supervised your sessions are all change the right answer. Start with the cleanup hook and the RAM logger. Check `~/.claude_resource.log` after a few sessions with local MCPs — the baseline-vs-session-end comparison will tell you whether you have a real leak or just normal variance.

If this "boring-but-essential setup" vibe resonates, I covered [environment variables the same way](https://ii4ki.github.io/blog/2026-05-07-the-boring-setup-that-prevents-disaster/) — different problem, same principle.

Further reading: [Anthropic's hooks reference](https://code.claude.com/docs/en/hooks) and [Kyle Redelinghuys' complete guide](https://www.ksred.com/claude-code-hooks-a-complete-guide-to-automating-your-ai-coding-workflow/).

_Running Playwright MCP, Chrome DevTools, or other heavyweight local servers? Which ones have caused you memory problems — and are you on Claude Code, Cursor, or something else? Drop it below._
