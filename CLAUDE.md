# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev      # dev server at localhost:4321
npm run build    # production build to ./dist/
npm run preview  # preview the production build
```

There are no lint or test scripts. Astro's type checker runs via `npm run astro check`.

## Architecture

This is an Astro 6 static site deploying to `https://ii4ki.github.io`. All routing is file-based under `src/pages/`.

**Layouts** — two layouts compose the entire page shell:
- `Base.astro` — root HTML, injects a theme-detection script (reads `localStorage` before first paint), renders `PathStrip → Nav → <slot> → Footer`
- `Post.astro` — wraps `Base.astro`, adds post header, tag chips, prev/next navigation, and a Giscus comment slot

**Content collections** (`src/content.config.ts`) — two typed collections:
- `blog` — Markdown posts, filtered by `draft: false` at query time, sorted by `pubDate` descending
- `projects` — filtered/sorted by `featured` and `order` on the home page; `status` drives CSS class names (`live`, `wip`, `archived`)

**Styling** — plain CSS only, no framework. All styles live in `src/styles/global.css`. Dark theme is `:root` (default); light is `:root[data-theme="light"]`. Custom properties (`--accent`, `--green`, `--muted`, etc.) are the entire design token system. Syntax tokens use only three colors: `--dim`, `--accent`, `--muted`.

**Theme toggle** — `localStorage.getItem('theme')` with a `data-theme` attribute on `<html>`. The inline `<script is:inline>` in `Base.astro` applies the stored theme before render to prevent flash.

**Reading time** — injected by the custom remark plugin at `src/plugins/remark-reading-time.mjs`. It adds `minutesRead` and `words` to the post's `remarkPluginFrontmatter`, which `src/pages/blog/[...slug].astro` forwards to `Post.astro` as props.

**Tags** — `src/lib/tags.ts` contains tag aggregation utilities used by the tags index and per-tag pages. Tags link to `/tags/[tag]`.

**Routing summary:**
- `/` — home (recent posts + featured projects)
- `/blog` — full post index
- `/blog/[slug]` — single post via `Post.astro`
- `/projects` — all projects
- `/tags` — tag index
- `/tags/[tag]` — posts filtered by tag
- `/rss.xml` — RSS feed
- `/about` — static about page

## Conventions

- **No UI framework** — Astro components only (`.astro`), no React/Vue/Svelte
- **No Tailwind or utility classes** — all styling via semantic class names in `global.css`
- **`src/consts.ts`** — site-wide constants (`SITE_TITLE`, `SITE_DESCRIPTION`); add new globals here
- Draft posts (`draft: true`) are excluded at the collection query level, not the file level
- Blog post filenames conventionally include the date: `YYYY-MM-DD-slug.md`
- Comments are powered by Giscus (`src/components/Comments.astro`), backed by Discussions in this repo's `Announcements` category, mapped by `pathname`. The widget is lazy-loaded via `IntersectionObserver`. Theme is a custom CSS URL (`/giscus-dark.css` or `/giscus-light.css`); a `MutationObserver` on `<html>[data-theme]` re-skins the iframe live on theme toggle.
