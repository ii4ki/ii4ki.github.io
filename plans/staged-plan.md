# ii4ki blog — staged integration plan

This consolidates everything we've worked out, with explicit decision points where you had questions, and concrete stages you can execute one at a time.

---

## A. Decisions to lock before stages

### 1. Script architecture — split into `cc-draft` + `cc-publish`

You're right. The current `cc-publish` is misnamed: both its subcommands produce **drafts** into `output/`, they don't publish anything. The new "ship to blog repo" step is fundamentally different (no LLM call, just a structured move). Keeping it as `cc-publish ship` works but muddies the model.

**Recommended split:**

| Script           | Subcommands                           | What it does                                                                             | LLM call? |
| ---------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| `bin/cc-draft`   | `blog [--pick\|<uuid>]`, `thread`     | exactly what `cc-publish` does today: session → draft in `output/`                       | yes       |
| `bin/cc-publish` | `[<slug>]`, `--list`, `--undo <slug>` | ship a finalized `output/.../post.md` into the blog repo as `src/content/blog/<slug>.md` | no        |

`cc-publish` with no args targets the latest `output/*/post.md` by mtime — same convention as `cc-draft thread`. `--list` shows draftable candidates. `--undo` removes the file from the blog repo (a `git rm` wrapper so you can't get it wrong).

Note: **threads don't ship anywhere automated.** They go to X/Threads manually. So `cc-publish` only handles blog posts. If you later automate thread publishing (Bluesky/Mastodon API), it'd be a separate `cc-broadcast` or similar, not a subcommand here.

**Trade-off considered:** one umbrella script with `draft` / `publish` / `thread` subcommands is also clean and gives you `cc <verb>` muscle memory. I'd still split because the two scripts have completely different dependencies (one needs `CONTENT_API_*`, the other needs `BLOG_REPO_PATH`); separate scripts mean `cc-publish --help` works on a machine with only the blog half configured. Minor, but real.

### 2. Repo topology — two repos, filesystem bridge, no submodules

| Decision          | Recommendation                                                            | Why                                                                           |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Number of repos   | 2: `content-creator` (private), `ii4ki/ii4ki.github.io` (public)          | Different lifecycles, different audiences, public required for Pages + Giscus |
| Connection        | env var `BLOG_REPO_PATH=/Users/tony/code/ii4ki.github.io` in `.env.local` | One-way, filesystem, no git mechanics to learn                                |
| Reverse coupling? | None                                                                      | The blog repo is unaware of `content-creator`                                 |
| Submodules        | No                                                                        | Add commit overhead, runner token complications, lag                          |
| Symlinks          | No                                                                        | Break when either repo is cloned to a different machine                       |

The bridge is one env var. That's the entire integration surface area.

`content-creator` stays private until v2 polish (decided). Nothing in the technical setup forces it either way; this is just so your `voice.md` and skill prompts aren't a public reference yet.

### 3. CI/CD — structured but not over-built

The right amount of structure for a personal blog at day 1:

| Layer               | Files                              | Purpose                                        |
| ------------------- | ---------------------------------- | ---------------------------------------------- |
| Reusable workflow   | `.github/workflows/_build.yml`     | install deps, build Astro, upload artifact     |
| Triggered workflows | `deploy.yml`, `pr.yml`             | call `_build.yml`, deploy is push-to-main only |
| Dependency hygiene  | `.github/dependabot.yml`           | weekly npm + actions updates                   |
| Cron jobs (later)   | `link-check.yml`, `lighthouse.yml` | added as features land                         |

Things to **bake in from day 1** because retrofitting is annoying:

- **Pinned action SHAs**, not tags. `uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11` not `@v4`. Renovate/Dependabot keeps them current. Pinning prevents supply-chain surprises.
- **Explicit `permissions:` block per workflow**, defaulting to `contents: read`. Deploy needs `pages: write` + `id-token: write`. Nothing else.
- **`concurrency:` block on deploy** so a newer push cancels an older build.
- **Node version pinned in `.nvmrc`** and consumed by `actions/setup-node@... { node-version-file: '.nvmrc' }`. One source of truth.
- **Caching `~/.npm` via `actions/setup-node`'s built-in cache.** Free perf, zero code.

Things to **defer**:

- Matrix builds (no need)
- Self-hosted runners (no need)
- Custom composite actions (premature; reusable workflow is enough)
- Status-badges-everywhere (one in the blog README is enough)
- Secrets management beyond `GITHUB_TOKEN` (you have no third-party CI secrets yet)

**Branch protection:** require `pr.yml` checks to pass before merge to `main`. Don't require PRs (you're solo); just require that *if* there's a PR, checks pass. This means you can push directly when you want, but if you open a PR for review, CI gates the merge.

### 4. Preserving Claude Design's work — the re-engagement plan

CD did good visual work and offered to scaffold the Astro project. **Decline the Astro scaffold** — CD doesn't know your content-creator integration, your env vars, your two-repo topology, or your CI shape. You'll get a generic scaffold that needs as much rework as it saves.

**Do go back to CD for these gaps**, after the Astro repo exists:

| Gap                          | Ask format                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles/global.css`          | "Produce the complete `global.css` matching the HTML mockups, with both `:root` (dark) and `:root[data-theme='light']` palettes, plus prefers-reduced-motion handling."                      |
| `about.html`                 | "Produce an about page in the same shell layout as `projects.html`, sections: what I do / what I write about / stack / contact."                                                             |
| `tags.html` (index)          | "Produce a tags index page: a single section listing every tag with post count, sorted by count descending. Same shell. No filtering UI."                                                    |
| Per-tag template             | "Generalize `tag-claude-code.html` into a template I can fill in for any tag. Single placeholder for `{TAG}` and `{POST_LIST}`."                                                             |
| 2 more sample posts          | "Produce two more post pages in the same chrome, different prose lengths (400 words and 1500 words), so I can validate the layout at extremes."                                              |
| OG image template (1200×630) | "Produce a standalone OG image HTML template in the terminal aesthetic: path strip with `[ ~/blog/<slug> ]`, big title, date, ii4ki signature in muted. Will be rendered to PNG via Satori." |
| Favicon                      | "Produce a 32×32 SVG favicon: monospace `>_` glyph in green on the dark background, with a light-theme variant."                                                                             |

Important: ask CD for **plain HTML/CSS deliverables**, not Astro components. You port them to `.astro` yourself when you scaffold. CD's plain HTML lasts; CD's Astro components will fight your `content.config.ts` and integrations.

---

## B. Implementation stages

Stages are sequenced so each one leaves a working state. You can stop at the end of any stage and the system still functions.

### Stage 0 — Prerequisites

| Step                                                                        | Status / Where                                |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| Create `ii4ki` org                                                          | ✅ done                                       |
| Create `ii4ki/ii4ki.github.io` repo                                         | ✅ done                                       |
| Confirm primary GH account is org `owner`                                   | org settings (verify before Stage 5 push)     |
| Enable Pages: source = "GitHub Actions"                                     | repo Settings → Pages (do before first push)  |
| Enable Discussions (needed later for Giscus)                                | repo Settings → General → Features            |
| Add SSH/HTTPS remote locally once scaffolded                                | Stage 5                                       |

Org-owned `<org>/<org>.github.io` serves at `https://<org>.github.io/` exactly like user-owned does. With `ii4ki/ii4ki.github.io` the site lives at `https://ii4ki.github.io/`, so `astro.config.mjs` uses `site: 'https://ii4ki.github.io'` and `base: '/'`.

### Stage 1 — content-creator refactor (local-only, no Astro yet) ✅ DONE

Everything in this stage is in your existing `content-creator` repo. No external dependencies.

1. ✅ **Renamed `bin/cc-publish` → `bin/cc-draft`.** All internal usage strings updated.
2. ✅ **Updated `skills/blog-post.md`** to emit a YAML frontmatter block at the very top:
   ```yaml
   ---
   title: <H1 text>
   description: <one-sentence promise pulled from para 1 or 2>
   pubDate: <today, YYYY-MM-DD>
   tags: []
   draft: false
   ---
   ```
   Tags stay empty; you'll fill them at ship time. The skill must not invent tags.
3. ✅ **Wrote the new `bin/cc-publish`.** Flow:
   1. Resolve slug: arg or latest `output/*/post.md`
   2. Require `BLOG_REPO_PATH` env
   3. Strip the `## Suggested visuals` section
   4. Validate frontmatter exists and has `title`, `description`, `pubDate`
   5. Prompt for tags: show existing tags from `$BLOG_REPO_PATH/src/content/blog/*.md`, accept comma-separated input, inject into frontmatter
   6. Write to `$BLOG_REPO_PATH/src/content/blog/<slug>.md`
   7. Print `git diff src/content/blog/` and the next-step commit command
4. ✅ **Updated `.env.example`** with `BLOG_REPO_PATH=` (commented placeholder).
5. ✅ **Updated `AGENTS.md`** — renamed references, added `BLOG_REPO_PATH` to env section, added script split rationale to architecture decisions, updated build status.
6. ✅ **Updated `README.md`** for the new `cc-draft` / `cc-publish` flow.

**Note on `BLOG_REPO_PATH` in `.env.local`:** currently set to the GitHub URL `https://github.com/ii4ki/ii4ki.github.io` — update to the local filesystem path once Stage 2 scaffolds the repo (i.e. `BLOG_REPO_PATH=/Users/tony/code/ii4ki.github.io`). End-to-end test of `cc-publish` is deferred until then.

Stage 1 leaves you with the draft → publish split working in isolation. The blog repo doesn't exist yet; you're just confirming the pipeline shape.

### Stage 2 — Blog repo scaffold (~30 min) ✅ DONE

1. `cd ~/code && npm create astro@latest -- ii4ki.github.io --template blog --typescript strict --no-install --no-git`
2. `cd ii4ki.github.io && git init -b main`
3. Install deps: `npm install`
4. Strip the default blog content but keep the scaffold (delete `src/content/blog/*.md`, leave the schema).
5. Strip the default styles entirely (you're replacing them).
6. Configure `astro.config.mjs`:
   ```js
   site: 'https://ii4ki.github.io',
   base: '/',
   integrations: [mdx(), sitemap()],
   markdown: { remarkPlugins: [remarkReadingTime] },
   ```
7. Set up the content schemas in `src/content.config.ts`:
   ```ts
   const blog = defineCollection({
     loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
     schema: z.object({
       title: z.string(),
       description: z.string(),
       pubDate: z.coerce.date(),
       updatedDate: z.coerce.date().optional(),
       tags: z.array(z.string()).default([]),
       draft: z.boolean().default(false),
       series: z.string().optional(),       // future-proofing
       heroImage: z.string().optional(),    // future-proofing
     }),
   });
   const projects = defineCollection({
     loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
     schema: z.object({
       name: z.string(),
       description: z.string(),
       status: z.enum(['LIVE', 'WIP', 'ARCHIVED']),
       stack: z.array(z.string()),
       repo: z.string().url().optional(),
       demo: z.string().url().optional(),
       writeup: z.string().optional(),      // /blog/<slug> path
       featured: z.boolean().default(false),
       order: z.number().default(0),
     }),
   });
   ```
8. Create the directory tree from `plans/initial-draft.md` (the "Wholesome v1 structure" section) — empty `.astro` and `.css` files as placeholders.
9. First commit.

Stage 2 leaves you with `npm run dev` running an empty-but-valid Astro site.

### Stage 3 — Design port (~half a day) ✅ DONE

All 23 files implemented. Commits: `feat(src): implement Stage 3 ii4ki design port` + `chore(refs): update HTML mockups, add about/og-template/tags`.

1. ✅ `src/styles/global.css` — complete ii4ki terminal design (dark/light palettes, all component classes, `.theme-btn` appended).
2. ✅ `src/layouts/Base.astro` — shell with FOUC-prevention inline script, `<PathStrip>`, `<Nav>`, `<slot />`, `<Footer>`.
3. ✅ `src/layouts/Post.astro` — wraps Base, renders post header + meta, `<slot />` in `.prose`, tag chips, prev/next nav.
4. ✅ Components: `PathStrip`, `Nav`, `ThemeToggle`, `Footer`, `Cursor`, `TagChip`, `PostCard`, `ProjectCard`, `Comments` (stub).
5. ✅ Pages: `index`, `about`, `blog/index`, `blog/[...slug]`, `projects`, `tags/index`, `tags/[tag]`, `404`, `rss.xml.js`.
6. ✅ Retired: `BlogPost.astro`, `Header.astro`, `HeaderLink.astro`, placeholder images.
7. ✅ `about.astro` content reflects actual stack (opencode, vercel, cloudflare) and GitHub handle (`bitcoin21ideas`).
8. ⬜ **Ship the first real post** from content-creator: `cd ~/code/content-creator && cc-publish 2026-05-07-the-boring-setup`. Verify it builds. (Deferred to after Stage 4 or as part of Stage 5 smoke-test.)

Stage 3 leaves you with a complete-looking site running on localhost.

### Stage 4 — CI/CD foundation (~1 hour) ✅ DONE

Commit: `ci: add deploy/pr workflows, dependabot, nvmrc, project README`

1. ✅ `.nvmrc` — Node 22.
2. ✅ `.github/dependabot.yml` — weekly npm + actions updates.
3. ✅ `.github/workflows/_build.yml` — reusable: checkout, setup-node (cache: npm), `npm ci`, `astro check` (type check), build, lychee internal link check (`--offline`), upload Pages artifact. All action SHAs pinned to commit hashes. `@astrojs/check` + `typescript` added as devDependencies.
4. ✅ `.github/workflows/deploy.yml` — `push: main` + `workflow_dispatch`, `pages: write` + `id-token: write`, no-cancel concurrency, two jobs: build + deploy.
5. ✅ `.github/workflows/pr.yml` — `pull_request` only, `contents: read`, cancel-in-progress concurrency, one build job.
6. ⬜ Branch protection on `main` — **manual step:** Settings → Branches → require `PR Check / build` status check, do not require PRs.
7. ✅ README — replaced Astro default with project README, deploy badge added.

Stage 4 leaves you with a self-healing deploy. Push to main → live site within ~2 minutes.

### Stage 5 — Launch (~30 min)

The repo already exists at `ii4ki/ii4ki.github.io`. This stage wires up the local scaffold to it and ships v1.

1. Add the remote and push:
   ```bash
   cd ~/code/ii4ki.github.io
   git remote add origin git@github.com:ii4ki/ii4ki.github.io.git
   git push -u origin main
   ```
2. Confirm Pages source is set to "GitHub Actions" (done in Stage 0; verify).
3. Watch the deploy run, hit `https://ii4ki.github.io/`, smoke-test:
   - Home loads, hero renders, light/dark toggle works
   - `/blog` lists the one real post
   - `/blog/<slug>` renders prose correctly, reading time shown
   - `/tags` shows all tags, each links to a valid `/tags/<tag>` page
   - `/projects`, `/about`, `/404` all render
   - `/rss.xml` validates (open in a feed reader)
   - `/sitemap-index.xml` exists
4. Custom domain: deferred (decided no for v1).

Stage 5 = the blog is live. You can stop here for a while and just write.

### Stage 6 — v2 features (~1 week, when you want them)

In rough order of payoff:

1. **Pagefind** — `npm install -D pagefind`, run `pagefind --site dist` as a post-build step in `_build.yml`, add a `Search.astro` component with `/pagefind/pagefind-ui.js`. Lazy-loaded behind `Ctrl+K`.
2. **Giscus** — run giscus.app config wizard against the repo, paste values into `Comments.astro`, drop on `[...slug].astro` below the post. Lazy-load with `loading="lazy"` and an `IntersectionObserver`.
3. ✅ **OG image generation via Satori** — done. Implemented as a dynamic Astro route (`src/pages/og/[...slug].png.ts`) instead of a standalone script — Satori template lives in `src/lib/og.ts`, fonts vendored under `src/assets/fonts/`, PNGs prerendered to `dist/og/<slug>.png` and referenced from `BaseHead` via an `image` prop threaded through `Base.astro` and `Post.astro`. Title font auto-shrinks; logo + `text-indent` lets wrapped title lines reclaim the full width.
4. **Code copy buttons** — rehype plugin in `src/plugins/rehype-code-copy.mjs`. Pure CSS button, tiny inline script for the click handler.
5. **`/now` page** — new top-level route, single markdown file at `src/content/meta/now.md`, manual update cadence.
6. **Lighthouse CI** — add `lighthouse-ci.yml` workflow that runs on PRs, perf floor 95. Don't fail the build for the first month; collect data first.

### Stage 7+ — Quality and reach (month 2+)

1. **Vale** prose linting on PRs (style: `Microsoft` or `write-good`)
2. **Weekly external link check** — cron workflow using lychee (already in build for internal links), checks external URLs, opens issues on 404s
3. **Crosspost to dev.to / Hashnode** — workflow on push that calls their APIs with canonical URLs
4. **Series support** — `series` field already in schema; add a `/series/[name].astro` route
5. **AI-suggested tags on PR** — workflow that calls Claude API with the post body + existing tag list, comments suggestions
6. **Webmentions** — webmention.io endpoint, display received mentions inline

Defer indefinitely: newsletter, TIL, analytics beyond GoatCounter, full auto-tweet.

---

## C. Locked decisions (do not re-litigate in implementation sessions)

| Decision                  | Locked answer                                                                |
| ------------------------- | ---------------------------------------------------------------------------- |
| Org / repo                | `ii4ki/ii4ki.github.io` (org-owned, public, already created)                 |
| Deploy URL                | `https://ii4ki.github.io/`                                                   |
| Custom domain             | No, deferred indefinitely                                                    |
| `content-creator` privacy | Private until v2 polish                                                      |
| Light theme               | Auto via `prefers-color-scheme`, manual toggle wins and persists             |
| Blog URL shape            | `/blog/<slug>` (leaves `/projects/<slug>` open for future)                   |
| Project pages             | Card-only on `/projects`. No per-project page for v1                         |
| First post                | Ship `2026-05-07-the-boring-setup` as-is; the site itself is the intro post  |
| LICENSE                   | MIT                                                                          |
| Astro template            | Official `blog` starter, then strip and re-skin                              |
| Styling approach          | Single `src/styles/global.css` with CSS custom properties. No Tailwind.      |
| Repo connection           | Filesystem bridge via `BLOG_REPO_PATH` env. No submodules, no symlinks       |
| Script split              | `bin/cc-draft` (was `cc-publish`) + new `bin/cc-publish` for shipping        |

---

## D. Current status and next steps

- ✅ Stage 0 — Prerequisites (org, repo created; Pages + Discussions to enable before Stage 5 push)
- ✅ Stage 1 — content-creator refactor done. `cc-draft` / `cc-publish` split is live.
- ✅ Stage 2 — Astro scaffold done. `npm run dev` serves an empty-but-valid site.
- ✅ Stage 3 — Design port done. All pages, layouts, and components implemented. `npm run build` passes clean.
- ✅ Stage 4 — CI/CD done. Workflows committed, 3 ahead of origin. One manual step: set branch protection in GitHub Settings.
- ⬜ Stage 5 — **Next up.** Launch. Push to origin, enable Pages, smoke-test.

**To start Stage 5:**
1. Enable Pages in repo Settings → Pages → Source: "GitHub Actions" (if not already done)
2. `git push -u origin main`
3. Watch Actions tab, then smoke-test `https://ii4ki.github.io/`

**Branch protection (one-time, after push):** Settings → Branches → add rule for `main` → require `PR Check / build` status check, do not require PRs.