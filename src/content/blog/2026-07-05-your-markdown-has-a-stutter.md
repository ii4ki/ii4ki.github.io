---
title: "Your Markdown Has a Stutter, and So Does Everyone Else's"
description: "Claude Code (and most LLMs) hard-wrap prose at ~80 columns and physically write the newline into your file. Anthropic closed the bug as 'not planned.' Here's the one-hook fix."
pubDate: 2026-07-05
tags: [ai, tooling, beginner]
draft: false
---

Open any markdown file Claude Code just wrote you, in a plain text editor instead of a rendered preview, and look closely at the paragraphs. Odds are they look like this:

```
- **Refactoring `lib/publish.js` touches the live daily publish path.** The extraction must be
  behavior-preserving — `test/publish.test.js` runs unchanged as the guard, and the create-only
  idempotency (no `sha` → 422 → `exists`) moves verbatim into `gh.putFile`. If any publish-test
  assertion needs editing, the refactor changed behavior → stop and reconcile.
```

That's not your editor wrapping long lines for readability. Those are real `\n` characters, physically baked into the file, breaking mid-sentence at almost exactly 80 characters. It renders fine in a Markdown preview — which is exactly why nobody catches it — but open the raw file in VS Code, `less` it in a terminal, or diff it, and it looks like the model has a stutter.

I went looking for why, assuming it was some obscure config knob I hadn't found. It isn't. It's a known, unfixed model behavior, and a huge number of people have run into it.

## This Is Not Just Me

A [GitHub issue](https://github.com/anthropics/claude-code/issues/33666) filed against Claude Code lays it out cleanly: the user configured 120-character lines for docs and 100 for commit messages in their `CLAUDE.md`. The model acknowledged the rule when asked directly, then kept wrapping at ~80 anyway. Status: **closed, "not planned."**

It's not an isolated report either — [#6827](https://github.com/anthropics/claude-code/issues/6827), [#13378](https://github.com/anthropics/claude-code/issues/13378), and [#32190](https://github.com/anthropics/claude-code/issues/32190) all describe some flavor of the same ~80-column hard wrap, mangling copy-paste and diffs. There's an [open feature request](https://github.com/anthropics/claude-code/issues/43113) asking for a `--no-word-wrap` flag so the terminal handles wrapping instead of the model — still unshipped as I write this.

The likely cause, once you think about it, is almost funny: the training corpus is _soaked_ in 80-column hard-wrapped text. Git commit conventions (wrap at 72), RFCs, man pages, decades of mailing-list plaintext, old READMEs — technical writing has hard-wrapped at 72–80 columns since before some of us were born. The model's prior for "what correct technical prose looks like" is quite literally wrapped-at-80. And because a single newline inside a Markdown paragraph collapses to a space when rendered, the model never gets corrective signal — in every preview, the mistake is invisible. It only surfaces in a raw editor, a terminal, or a diff. Which, if you're a developer, is most of your day.

## Enter Prettier

If you've touched a JS/TS codebase in the last eight years you already know [Prettier](https://prettier.io/) — the opinionated formatter that takes your code (and, less famously, your Markdown) and rewrites it into one canonical style, so nobody argues about tabs vs. spaces ever again. It ships with an option that exists for almost exactly this problem: [`proseWrap`](https://prettier.io/docs/en/options.html#prose-wrap).

Set it to `never`, and Prettier takes any Markdown paragraph — however many times the model has hard-wrapped it — and collapses it back down to a single logical line. One paragraph, one line, however long. Your editor's soft-wrap makes it _display_ nicely; the bytes stay clean, so diffs only show the sentence that actually changed instead of every line after it reflowing.

Running it on the snippet above:

```
- **Refactoring `lib/publish.js` touches the live daily publish path.** The extraction must be behavior-preserving — `test/publish.test.js` runs unchanged as the guard, and the create-only idempotency (no `sha` → 422 → `exists`) moves verbatim into `gh.putFile`. If any publish-test assertion needs editing, the refactor changed behavior → stop and reconcile.
```

One line. Soft-wraps fine in any editor, diffs cleanly, no more stutter.

## Automate It: A PostToolUse Hook

Running Prettier by hand after every file Claude touches defeats the point. The fix is a [hook](https://ii4ki.github.io/blog/2026-05-20-hooks-to-the-rescue/) — same mechanism I covered for killing orphaned MCP processes, pointed at a much smaller problem. A `PostToolUse` hook on `Write`/`Edit`/`MultiEdit` that runs Prettier automatically, every time, on every `.md` file — no memory required, no relying on the model to remember a rule about line width.

Drop this in `.claude/settings.json` (project-level, so it applies to the repo regardless of which machine or account opens it):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // .tool_response.filePath // empty' | { read -r f; case \"$f\" in *.md) npx --yes prettier --prose-wrap never --write \"$f\";; esac; } 2>/dev/null || true",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

What it does, in order: reads the JSON Claude Code pipes to every hook on stdin, pulls out `file_path` with `jq`, checks the extension, and — only for `.md` files — hands it to `npx prettier --prose-wrap never --write`. Everything else passes through untouched. First run downloads Prettier via `npx` and caches it; after that it adds tens of milliseconds per file, not seconds.

One gotcha worth knowing before you copy-paste this everywhere: Prettier's Markdown formatting does more than unwrap paragraphs — it also normalizes bullet characters, heading style, and list numbering. Fine for prose, possibly not what you want on structured data files disguised as `.md`. If you've got a directory like that, add a `.prettierignore` at the repo root excluding it — Prettier respects it natively, no hook changes needed.

## The Gist

- **Claude Code (and other LLMs) insert real hard newlines into Markdown at ~80 columns.** It's a training-data artifact, not a rendering bug — the model's prior for "correct prose" comes from decades of 80-column-wrapped technical writing.
- **It's invisible in rendered previews** because Markdown collapses a mid-paragraph newline to a space — which is exactly why the model never gets corrected and the bug survives raw-editor and diff contexts indefinitely.
- **It's a known, reported, closed-as-"not-planned" issue** — you are not holding it wrong, and there's no config flag coming to fix it upstream any time soon.
- **`prettier --prose-wrap never`** collapses every paragraph back to one line, letting your editor's soft-wrap do the visual work while keeping diffs clean.
- **A `PostToolUse` hook** runs it automatically after every Write/Edit/MultiEdit, so you never think about it again.

Five minutes of setup, and you never see a mid-sentence line break in a raw markdown file again.

_Noticed this stutter in your own AI-written docs, or found a cleaner fix? Find me on Threads – [@tony_crusoe](https://www.threads.com/@tony_crusoe)_
