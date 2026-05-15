## Quick answers to your direct questions

**Reading time at build vs JS — you're right, build-time is better.** Astro's official recipe uses a remark plugin that injects `minutesRead` into frontmatter during the markdown parse, then your component just renders `{remarkPluginFrontmatter.minutesRead}`. Zero client JS, no flash of un-calculated content, and it works inside RSS too. The dev.to "calculate in JS" approach is older and inferior.

**The Cloudflare brayden template — don't use it.** Two reasons:
1. It's optimized for **Cloudflare Workers** deployment (`wrangler.json`), not GitHub Pages. You'd be ripping out the deploy layer on day one.
2. It's intentionally minimal — no tags, no search, no comments, no reading time. You'd be adding everything anyway, so the only thing you'd inherit is its design (which you're replacing with the terminal theme).

There's a better base.

## Recommended base: official `blog` example + Astro Micro patterns as reference

Three options I evaluated:

| Template                                                    | Pros                                                                                       | Cons                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **`npm create astro@latest -- --template blog`** (official) | Canonical, Content Collections set up, RSS + sitemap, no styling lock-in, deploys anywhere | Spartan; you add Pagefind/Giscus/tags                                                  |
| **Astro Micro** (`markhorn-dev/astro-micro`)                | Pagefind + Giscus + RSS + theme toggle already wired, framework-free                       | TailwindCSS (you didn't want it), not terminal-themed, you'd fight the existing design |
| **Cloudflare brayden**                                      | Has Cloudflare-native deploy                                                               | Wrong deploy target for you, missing every feature you want                            |

**Use the official blog template as your base.** Keep [Astro Micro's repo](https://github.com/markhorn-dev/astro-micro) open in a second tab as a reference for *how* to wire Pagefind and Giscus into a framework-free Astro project — copy the patterns, not the styles.

## Wholesome v1 structure (with clear expansion seams)

```
ii4ki.github.io/
├── astro.config.mjs                    # site, base, integrations, markdown.remarkPlugins
├── package.json
├── tsconfig.json
├── src/
│   ├── content.config.ts               # Zod schemas: blog, projects
│   ├── content/
│   │   ├── blog/                       # synced from content-creator (see below)
│   │   │   └── 2026-05-07-the-boring-setup.md
│   │   └── projects/                   # one .md per project, frontmatter-driven
│   │       ├── content-creator.md
│   │       └── personal-statusline.md
│   ├── layouts/
│   │   ├── Base.astro                  # path-strip header, nav, footer
│   │   └── Post.astro                  # post chrome + prose container
│   ├── components/
│   │   ├── PathStrip.astro
│   │   ├── Nav.astro
│   │   ├── PostCard.astro
│   │   ├── ProjectCard.astro
│   │   ├── TagChip.astro
│   │   ├── Cursor.astro                # CSS-only blinking cursor
│   │   ├── ThemeToggle.astro           # tiny island for light/dark
│   │   └── Comments.astro              # Giscus, lazy-loaded
│   ├── pages/
│   │   ├── index.astro                 # home: hero + recent posts + featured projects
│   │   ├── about.astro
│   │   ├── projects.astro              # iterates getCollection('projects')
│   │   ├── blog/
│   │   │   ├── index.astro             # all posts
│   │   │   └── [...slug].astro         # dynamic post pages
│   │   ├── tags/
│   │   │   ├── index.astro             # ALL TAGS LIST (the one you flagged missing)
│   │   │   └── [tag].astro             # per-tag, getStaticPaths from all post tags
│   │   ├── rss.xml.js
│   │   └── 404.astro
│   ├── styles/
│   │   └── global.css                  # palette vars under :root and [data-theme="light"]
│   ├── plugins/
│   │   └── remark-reading-time.mjs     # build-time injection
│   └── lib/
│       └── tags.ts                     # getAllTags(), tagCounts()
├── public/
│   ├── favicon.svg                     # ASCII-style mono mark
│   └── og-default.png
└── .github/
    └── workflows/
        ├── deploy.yml                  # Astro build → actions/deploy-pages
        └── linkcheck.yml               # weekly cron (added in expansion)
```

The three "expansion seams" you want to design in from day one:

- `src/lib/` for utility functions (tag aggregation, post sorting, search index helpers). Adding a `series.ts` later is a new file, not a refactor.
- `src/plugins/` for remark/rehype plugins. Reading time is plugin #1; later you add code-copy-button, link-card-embed, etc., without touching pages.
- `src/content/` schemas with `.optional()` fields you don't use yet (`series`, `updated`, `cover`). Future features extend the schema; old posts still validate.

## Reading time, the canonical wiring

`src/plugins/remark-reading-time.mjs`:

```js
import getReadingTime from 'reading-time';
import { toString } from 'mdast-util-to-string';

export function remarkReadingTime() {
  return (tree, { data }) => {
    const text = toString(tree);
    const readingTime = getReadingTime(text);
    data.astro.frontmatter.minutesRead = readingTime.text;
    data.astro.frontmatter.words = readingTime.words;
  };
}
```

`astro.config.mjs`:

```js
import { remarkReadingTime } from './src/plugins/remark-reading-time.mjs';

export default defineConfig({
  markdown: { remarkPlugins: [remarkReadingTime] },
});
```

In the post page:

```astro
const { Content, remarkPluginFrontmatter } = await render(entry);
<span class="meta">{remarkPluginFrontmatter.minutesRead}</span>
```

That's it. Build-time, zero JS, ships in RSS too.

## Content-creator → blog handoff (the part you asked about)

You have three architecturally clean choices. Pick one based on how coupled you want the repos.

**Option A — Sync script in `content-creator` (recommended).** Add a third `cc-publish` subcommand. The new step happens *after* you've edited `output/YYYY-MM-DD-<slug>/post.md` and decided it's ready.

```
cc-publish ship 2026-05-07-the-boring-setup
  1. read output/2026-05-07-the-boring-setup/post.md
  2. strip the ## Suggested visuals section
  3. prompt: "tags? [comma-separated, existing: secrets, opsec, bash, claude-code, ...]"
  4. prepend YAML frontmatter (title from H1, date from dir name, description, tags)
  5. write to $BLOG_REPO/src/content/blog/2026-05-07-the-boring-setup.md
  6. print: "cd $BLOG_REPO && git diff src/content/blog/"
```

Why it's right: respects the manual-gate philosophy already documented in `AGENTS.md`, the two repos stay decoupled, GitHub Actions in the blog repo is self-contained (no submodule init), and undoing a publish is `git rm` on one file.

**Option B — Git submodule.** `content-creator/output/` becomes a private submodule of the blog repo. The deploy action runs `git submodule update --init`. Downside: the submodule pin lags real edits, you have to commit twice, and submodules in GitHub Actions need a token if the content repo is private. Adds friction for a solo author.

**Option C — Astro 5+ custom content loader.** Write a loader that reads from `~/code/content-creator/output/**/post.md` at build time. Elegant locally; broken on GitHub Actions because the runner doesn't have your `~/code/` directory. Not viable for your deploy target.

Take Option A. It's the only one that respects "manual gate" and works on a vanilla GitHub Actions runner.

### What `cc-publish ship` needs from the blog skill

The current `skills/blog-post.md` emits a post starting with H1 and no frontmatter. Two minimal additions to make ship-friendly:

1. Update the skill to emit a YAML frontmatter block at the very top: `title`, `description` (one sentence, from the post's promise paragraph), and leave `tags` for the user to fill in. The skill should NOT invent tags; tagging is editorial.
2. Add a `BLOG_REPO_PATH` env var to `.env.local`. `cc-publish ship` errors out if it's unset.

That's the whole integration. ~40 lines of bash added to `cc-publish`.

## Strategy for expansion (in order)

**v1 — ship the bones (week 1–2)**
1. Scaffold from official blog template
2. Port your ii4ki-html design into Astro components + `global.css` with the locked palette
3. Wire reading time, tags index, per-tag pages, RSS, sitemap, 404
4. Light theme toggle (CSS vars under `[data-theme="light"]`, small island for the button)
5. GitHub Action: build + `actions/deploy-pages` on push to `main`
6. Add `cc-publish ship` to content-creator; ship the boring-setup post as the first real entry

**v2 — make it useful for readers (week 3–4)**
1. Pagefind search + `Ctrl+K` (drop-in after build, ~10 KB runtime)
2. Giscus comments on posts (requires public repo + Discussions enabled; lazy-load below the fold)
3. OG image generation via Satori, in the terminal aesthetic (path strip + title + date)
4. Code copy button as a rehype plugin
5. `/now` page
6. Lighthouse CI workflow (perf floor 95)

**v3 — quality + reach (month 2+)**
1. Vale prose linting on PRs (catches passive voice, weasel words)
2. Weekly broken-link check (cron, opens issues)
3. Crosspost to dev.to / Hashnode with canonical URLs
4. Series support (schema field + an index page that groups posts by series)
5. AI-suggested tags on PR (Claude API call, comments suggested tags from existing pool; doesn't auto-apply)
6. Webmentions via webmention.io once you cross-post anywhere social

**Defer indefinitely**

- Newsletter signup (vanity at 0 subscribers)
- TIL feed (premature editorial split)
- Analytics — if you must, GoatCounter, one script tag, no DB
- Auto-tweet on publish — you already have `cc-publish thread` doing the right shape

## What I'd do right now

Three options for the next step, in order of leverage:

1. **I scaffold the blog repo locally** using the official template, port the ii4ki-html design into Astro components + `global.css` with both palettes, and wire reading time + tags index + 404. You review the running site, then we create the GitHub org and push.
2. **Write the `cc-publish ship` script first** so the integration shape is fixed before the blog scaffolding starts. Smaller blast radius; lets you iterate on the handoff without touching Astro.
3. **Update `skills/blog-post.md` to emit frontmatter**, so the next post you generate is already ship-shaped. 10-minute change.

Option 1 is the biggest leap; option 3 is the smallest. Want me to start with option 1, or sequence them 3 → 2 → 1?

Sources:
- [Add reading time — Astro Docs](https://docs.astro.build/en/recipes/reading-time/)
- [Content collections — Astro Docs](https://docs.astro.build/en/guides/content-collections/)
- [astro-blog-starter-template-brayden (Cloudflare)](https://github.com/cloudflare/astro-blog-starter-template-brayden)
- [Astro Micro (markhorn-dev)](https://astro-micro.vercel.app/)
- [Adding reading time to Astro without the hassle — Jahir Fiquitiva](https://jahir.dev/blog/astro-reading-time)
- [How to integrate Giscus to your Astro Blog — maxpou.fr](https://www.maxpou.fr/blog/giscus-with-astro/)
- [How To Use Obsidian To Write Astro Markdown Content (submodule pattern) — Bryan Hogan](https://bryanhogan.com/blog/obsidian-astro-submodule/)
- [External content collections — withastro/roadmap discussion #434](https://github.com/withastro/roadmap/discussions/434)