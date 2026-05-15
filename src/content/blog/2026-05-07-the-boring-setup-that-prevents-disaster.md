---
title: The Boring Setup That Prevents Disaster
description: "Three layers that keep API keys out of AI context windows and credentials out of the process list — applied to a real greenfield project."
pubDate: 2026-05-07
tags: [ai, security, beginner]
draft: false
---

I sat down to scaffold a new project this week. It was supposed to be simple: wire up a Cloudflare Workers AI pipeline, set a few environment variables, and start publishing. This time, I wanted to get the security setup right from day one — not scramble to patch it after the fact.

A couple of weeks ago the Vercel breach forced me to rotate credentials across an existing project. Scrambling through files, checking what was exposed, hoping nothing slipped — that's not how you want to spend an afternoon. It pushed me to write [a proper piece on secret management](https://dev.to/21ideas/secret-management-for-vibe-coders-the-system-i-wish-i-had-a-year-ago-531o): a system for keeping secrets safe when AI agents are reading your code. That post was the theory. This one is what it looks like applied to a greenfield project for the first time.

Before that incident, I'd been winging it. Most of my projects relied on `.gitignore` and hope. I knew agents like Claude and Cursor could index the entire repo. I just hadn't thought seriously about what happened if they opened the wrong file.

This session wasn't about shipping a feature. It was about building a foundation boring enough that most people skip it. Here's what I actually set up.

## First: Agents Can Read Your Repo (So Limit What They See)

AI coding tools are powerful because they have context. They see your file tree, your imports, your config files. That context becomes a liability when it includes real secrets.

I was initializing the content-creator repo to call Cloudflare Workers AI, which meant I needed an API key and account ID stored somewhere local. The obvious place was `.env.local`. The less obvious question was how to make sure no agent ever read it.

Git ignore isn't enough. Git keeps files out of commits, but it doesn't stop an AI assistant from opening a file that's sitting right there in your working directory. I needed agent-level blocks, not just version control.

## The Three Files That Actually Matter

I ended up creating three specific guardrails.

First, `.claude/settings.json` with a denyList. This blocks Claude Code from running `Read` or `Bash(cat)` on `.env.local`. I had to be careful here, because I wanted agents to still read `.env.example` for variable names. The denyList specifically excludes `.env.example` while blocking `.env.local` and `.env.*.local`.

```json
{
  "permissions": {
    "deny": [
      "Read(.env.local)",
      "Read(.env.*.local)",
      "Bash(cat .env*)",
      "Bash(echo $CONTENT_API*)",
      "Bash(printenv CONTENT_API*)"
    ]
  }
}
```

That's one file doing three jobs: blocks direct reads, blocks shell echoing, and blocks printenv for the specific variables that hold live credentials.

Second, every AI tool has its own approach to ignoring files. Cursor, for instance, doesn't use `.gitignore` for its indexer, so it needs a `.cursorignore` file. If you're using a different tool, look up how it handles context exclusions. The pattern is the same everywhere: tell the agent what not to read, by name.

Third, `AGENTS.md`. I added an explicit rule telling agents they must never output values from `.env*` files, and pointing them to `.env.example` as the safe source for variable names.

One thing none of these files can protect against: pasting your actual secrets inside the IDE where the agent is already running. Create `.env.local` in a separate terminal, outside the IDE entirely. Type the values there, save, close. The agent never sees the keystrokes.

That's the access layer handled.

## The Leak You Won't Find in `.gitignore`

The hidden problem was in my own script. `cc-publish` calls Cloudflare's API using `curl` with a `Bearer` token header. The original version passed the key directly in the command:

```bash
curl -H "Authorization: Bearer $CONTENT_API_KEY"
```

Anyone running `ps aux` on the machine could see that token in plain text while the request was in flight.

The fix was writing the header to a temporary file, locking it down with `chmod 600`, and passing it to `curl` via `--config`. The temp file gets deleted whether the call succeeds or fails. The key never touches the process list.

The broader point is worth pausing on: do a thorough back-and-forth with your agent, walk through every moving part that touches credentials, and make sure nothing slips through. The boring parts are the ones that bite you.

> **The rule:** if you wouldn't type a password into a public terminal, don't paste it into a shell argument either.

## The Gist

Environment variables aren't glamorous. Neither is spending an afternoon on scaffolding while your actual build waits. But this is the work that keeps your API keys out of AI context windows and your deployment credentials out of the process list.

Three layers in practice: `.claude/settings.json` and your tool's equivalent ignore file keep agents from reading credentials. `AGENTS.md` sets explicit rules so agents know what to avoid even when they could technically access it. And `curl --config` with a temp file keeps tokens out of the process list entirely. None of it is exciting. All of it is necessary.

I built this while scaffolding the content-creator pipeline, but the approach applies to any project where AI tools have access to your working directory.

> _Building something with AI tools? I'd love to hear what you're working on. I write about vibe coding, building in public, and the workflows that actually stick. Find me on Threads – [@tony_crusoe](https://www.threads.com/@tony_crusoe)_
