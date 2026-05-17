# ii4ki.github.io

[![Deploy](https://github.com/ii4ki/ii4ki.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/ii4ki/ii4ki.github.io/actions/workflows/deploy.yml)

Personal site and blog built with [Astro 6](https://astro.build), deployed to GitHub Pages at [ii4ki.github.io](https://ii4ki.github.io).

## Stack

- **Astro 6** — static site generator
- **MDX** — extended markdown for blog posts
- **@astrojs/sitemap** — auto-generated sitemap
- **@astrojs/rss** — RSS feed at `/rss.xml`
- **reading-time** — estimated read time injected via remark plugin
- **Giscus** — comments backed by GitHub Discussions, lazy-loaded, custom-themed to match the site

## Project Structure

```
src/
├── components/        # Astro UI components (Nav, Footer, PostCard, TagChip, …)
├── content/
│   ├── blog/          # Markdown posts (.md)
│   └── projects/      # Project entries (.md)
├── layouts/
│   ├── Base.astro     # Root HTML shell
│   └── Post.astro     # Blog post layout
├── lib/
│   └── tags.ts        # Tag aggregation utilities
├── pages/
│   ├── index.astro
│   ├── about.astro
│   ├── blog/          # Blog index + [slug] route
│   ├── projects.astro
│   ├── tags/          # Tags index + [tag] route
│   ├── rss.xml.js
│   └── 404.astro
├── plugins/
│   └── remark-reading-time.mjs
├── styles/
│   └── global.css
└── consts.ts          # SITE_TITLE, SITE_DESCRIPTION
```

## Content Collections

### `blog`

Files in `src/content/blog/*.md`. Required frontmatter:

```yaml
title: string
description: string
pubDate: date
tags: [string]          # optional, defaults to []
draft: boolean          # optional, defaults to false
updatedDate: date       # optional
series: string          # optional
heroImage: string       # optional
```

### `projects`

Files in `src/content/projects/*.md`. Required frontmatter:

```yaml
name: string
description: string
status: LIVE | WIP | ARCHIVED
stack: [string]
repo: url               # optional
demo: url               # optional
writeup: string         # optional
featured: boolean       # optional, defaults to false
order: number           # optional, defaults to 0
```

## Commands

| Command           | Action                              |
| :---------------- | :---------------------------------- |
| `npm install`     | Install dependencies                |
| `npm run dev`     | Dev server at `localhost:4321`      |
| `npm run build`   | Build to `./dist/`                  |
| `npm run preview` | Preview production build locally    |

## Requirements

Node >= 22.12.0
