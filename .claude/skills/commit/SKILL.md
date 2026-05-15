---
name: commit
description: Smart multi-step git commit workflow. Gathers state, triages sensitive/generated files, checks CHANGELOG, groups changes into logical units, proposes a plan, and executes with conventional commit messages. Human-invocable only.
disable-model-invocation: true
version: "1.0.0"
author: "bitcoin21ideas"
---

# Smart Git Commit

This skill is **human-invocable only** (`disable-model-invocation: true`). The model will not auto-trigger it; the user runs it explicitly via `/commit`.

## Step 1: Gather state

Run in parallel:

- `git status` (never use `-uall`)
- `git diff --stat` (unstaged summary)
- `git diff --cached --stat` (staged summary)
- `git log --oneline -20` (recent history, style reference for commit messages; if the repo has no commits yet, follow the format below)

If user provided arguments via `$ARGUMENTS`, treat them as a hint for the commit message or scope.

## Step 2: Triage

- **Nothing to commit** (clean tree, nothing staged, no untracked): report "Nothing to commit." and stop.
- **Merge conflicts**: list conflicted files and stop.
- **Sensitive files** (`.env`, `.env.local`, `.env.*`, anything containing live credentials): never read, `cat`, `echo`, or otherwise output their contents (AGENTS.md rule). Warn the user, exclude by default, and only stage if the user explicitly overrides. `.env.example` is the only env file safe to inspect.
- **Generated / ignored artifacts** (`dist/`, `.astro/`, `.DS_Store`, anything in `.gitignore`): flag if staged or untracked and exclude.

## Step 3: Blog post frontmatter check

If the change includes any new or modified files under `src/content/blog/`:

- Read the file and confirm the YAML frontmatter block is present and contains all required fields: `title`, `description`, `pubDate` (YYYY-MM-DD), `tags` (array, may be empty), `draft` (boolean).
- If any required field is missing: report which fields are absent and stop. Do not commit an incomplete post.
- `draft: true` posts are fine to commit; just confirm `draft` is explicitly set.
- Trivial prose edits to existing posts (typos, rewording) do not require this check — only new files or frontmatter-touching edits.

## Step 4: Respect staging intent

If the staged summary from step 1 is non-empty:

- Read full diffs for all staged files (`git diff --cached -- <file>`) to understand what they contain.
- If the staged files clearly span unrelated concerns (e.g. a skill prompt change mixed with a docs-only update), flag this in the Step 6 proposal and offer to split them. Do not split without the user's approval.
- If the user confirms they want to commit as-is, honor that. Do not unstage or rearrange without explicit permission.
- Only analyze unstaged/untracked files for additional commits after resolving the staged unit.

If nothing is staged, analyze all changed and untracked files.

## Step 5: Analyze and group

Read full diffs for all changed files (`git diff -- <file>` or `git diff --cached -- <file>`) to understand the nature of each change. For binary files, the stat line from step 1 is sufficient, skip the full diff. Group into logical commit units:

- Same feature/area belongs together (e.g. a new component plus the page that imports it).
- Unrelated changes split into separate commits.
- Order commits logically: dependencies and refactors before features, features before docs.
- Single logical change = single commit.

## Step 6: Propose the plan

Present a summary to the user:

- Number of commits and rationale for splitting (or not).
- For each commit: files included and the proposed message.

Ask for approval before proceeding. Wait for explicit confirmation.

If the user rejects the plan or requests changes (different wording, different file grouping, etc.), revise and re-propose. If the user wants to skip a particular commit, drop it and proceed with the rest.

## Step 7: Execute

For each commit:

1. Stage specific files: `git add <file1> <file2> ...` (never `git add -A` or `git add .`).
1. Commit with HEREDOC:

   ```bash
   # Single-line message
   git commit -m "$(cat <<'EOF'
   type(scope): subject line
   EOF
   )"

   # Multi-line message with body
   git commit -m "$(cat <<'EOF'
   type(scope): subject line

   - first change description
   - second change description
   EOF
   )"
   ```

1. Run `git status` to verify.

## Commit message format

```text
type(scope): lowercase subject, imperative mood, no period
```

- **Types**: `feat`, `fix`, `docs`, `chore`, `perf`, `test`, `tune`, `refactor`, `revert`, `build`, `ci`, `style`
- **Scope**: optional, area of change. Derive from project structure:
  - `content` — blog posts or project entries under `src/content/`
  - `pages` — Astro pages under `src/pages/`
  - `components` — components under `src/components/`
  - `layouts` — Base/Post layouts under `src/layouts/`
  - `styles` — `src/styles/global.css`
  - `plugins` — remark/rehype plugins under `src/plugins/`
  - `lib` — utility functions under `src/lib/`
  - `ci` — GitHub Actions workflows under `.github/`
  - `config` — `astro.config.mjs`, `tsconfig.json`, `package.json`
  - `deps` — dependency version bumps only
  - `public` — static assets under `public/`
- **Subject**: lowercase, imperative ("add X" not "added X"), no trailing period, max ~72 chars
- **Body**: bullet points for multi-change commits; explanation paragraph for non-obvious fixes
- **No em dashes** anywhere in commit messages. Use commas, colons, or parentheses for listing related items: `feat(components): PostCard, TagChip stubs`
- **NEVER** add `Co-Authored-By` trailer
- **NEVER** use `--no-verify` or skip hooks

Match the style of recent commits from the `git log` output gathered in step 1.
