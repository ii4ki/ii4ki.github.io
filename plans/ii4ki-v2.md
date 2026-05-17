# ii4ki blog — v2 staged plan

Stages 1–5 from [staged-plan.md](./staged-plan.md) are complete. The site is live at `https://ii4ki.github.io/`, deploys via GitHub Actions on push to `main`, and authoring is wired through `cc-draft` → `cc-publish` in the `content-creator` repo. This document expands stages 6+ into concrete, sequenced work.

It replaces stages 6 and 7 of the original plan. Anything not covered here defers indefinitely.

**Current priorities (decided 2026-05-17):** Stage 8.3 (Giscus) ✅ done, 8.4 (code copy buttons) ✅ done. Stage 8.2 (Satori OG) is next, then Stage 6 (dev.to crosspost). Stage 7 (Resend newsletter) is **deferred until there's a real reader signal** — no point provisioning a list with no subscribers waiting for one. Stage 8.6 (analytics) is already done via Umami.

---

## A. Architectural constraints to keep in mind

These dictate every choice below — re-deriving them in each stage wastes cycles.

1. **The blog itself is fully static, hosted on GitHub Pages.** No server-side rendering, no edge handlers, no environment variables at runtime. Anything that needs a runtime endpoint (subscribe form, double opt-in confirm, unsubscribe link, webmentions receiver) must live outside the Pages deploy. Default landing zone for those endpoints: **Cloudflare Workers** (free tier covers the volume by orders of magnitude, and you already use Cloudflare for DNS).
2. **The blog repo is public; `content-creator` is private.** Anything that holds secrets (Resend API key, dev.to API key) lives in the public repo's **Actions secrets**, never in the source tree. Cross-posting and broadcast workflows run as GitHub Actions because they need network egress with secrets.
3. **Authoring entry point stays `cc-draft` → `cc-publish`.** New v2 features must not add a third script the user has to remember. If a feature needs author-side state (e.g., dev.to article ID after first sync), it gets stamped into the blog repo by an Action — the human keeps writing posts the same way.
4. **No vendored CSS framework, no React in the runtime.** React Email is fine at build/send time; nothing React reaches the browser.
5. **Free tiers only for v2.** If a feature needs a paid plan to be useful, defer it.

---

## B. Stage 6 — Cross-posting to dev.to (syndication)

### Goal

Every published blog post is mirrored to dev.to with `canonical_url` pointing back to `https://ii4ki.github.io/blog/<slug>`. Edits to the source post update the existing dev.to article in place — never create a duplicate.

### Why dev.to specifically, why now

- **Audience proximity.** dev.to is where most of the target audience (devs interested in tooling, Claude Code, agentic workflows) already reads. Cross-posting is the cheapest way to reach them without depending on social.
- **Canonical-safe.** dev.to has first-class `canonical_url` support — Google de-duplicates correctly, and the SEO juice stays on `ii4ki.github.io`. ([why this matters](https://draft.dev/learn/syndicating-developer-content))
- **API quality.** Forem's article API is stable, well-documented, and lets you both create and update articles with a single field swap. Idempotency by tracking article ID is straightforward.

### Why **not** Hashnode / Medium in this stage

- **Hashnode** also supports canonical URLs (`originalArticleURL`) and has an API. Defer to stage 6b only if there's actual audience overlap; otherwise it's churn for vanity.
- **Medium** is hostile to canonical URLs (they get stripped or ignored for SEO purposes), and its API is unreliable. Skip indefinitely.

### Design: how to do create-vs-update correctly

The single hardest problem here is: **after the first sync, the post has a dev.to article ID, and we must remember it.** If we lose it, the next edit creates a duplicate. The two viable options:

| Option | Where IDs live | Pros | Cons |
|---|---|---|---|
| **Frontmatter** (`devto_id: 1234567`) | Inside the post file | Co-located with the content; survives repo moves; no extra files | Pollutes the post schema with platform-specific state; commit churn on every cross-post |
| **Sidecar state file** (`.crosspost-state.json` at repo root) | One JSON map: `{ slug: { devto_id, devto_url, last_synced } }` | Keeps post files clean; one commit per sync batch; easy to extend with hashnode_id later | One extra file to grep; if deleted, next run duplicates |

**Recommendation: sidecar.** Keeps the content schema platform-agnostic and makes it trivial to extend to Hashnode later without re-migrating frontmatter. The file is committed back to the repo by the workflow.

```jsonc
// .crosspost-state.json
{
  "2026-05-07-the-boring-setup-that-prevents-disaster": {
    "devto": {
      "id": 1827344,
      "url": "https://dev.to/ii4ki/the-boring-setup-...",
      "last_synced": "2026-05-17T14:22:00Z",
      "content_hash": "sha256-abc..."
    }
  }
}
```

The `content_hash` lets the workflow skip API calls when nothing changed — important once dev.to's rate limits bite (Swyx documented CI breakage from this in 2021; the [2026 follow-up](https://dev.to/ankitg12/publishing-to-devto-programmatically-in-2026-what-actually-works-2nkd) doesn't publish hard numbers, so we engineer defensively).

### Design: per-post opt-out

Add an optional frontmatter field, defaulting to syndicate-everything:

```yaml
crosspost:
  devto: false  # default true; explicit false to skip
```

Use case: posts that are platform-specific call-outs, or drafts in disguise (e.g., a tag-experiment post you don't want amplified).

### Design: tags mapping

Frontmatter `tags` are kebab-case (`claude-code`, `static-sites`). dev.to wants lower-case strings, max 4 tags, no spaces. Add a `crosspost-tags-map.json` only if a mismatch shows up — otherwise pass through verbatim and slice to first 4. Keep this dumb until it has to be smart.

### Design: image handling

Blog posts will eventually have `heroImage`. dev.to's `main_image` wants an absolute URL. Convention: every `heroImage` in frontmatter is a path under `/public/`, and the sync script rewrites it to `https://ii4ki.github.io/<path>`. Inline images in body Markdown work the same way — relative paths get prefixed during sync. Defer until the first post actually uses an image.

### Stage 6 implementation steps

1. **Provision API key.**
   - Generate at https://dev.to/settings/extensions (the "DEV Community API Keys" panel).
   - Add to repo Actions secrets as `DEVTO_API_KEY`.
   - Add `dev.to` username (`ii4ki`?) to a non-secret repo variable `DEVTO_USERNAME` for URL construction.
2. **Write `scripts/crosspost-devto.mjs`** (in the blog repo, run by CI — no new local script). Responsibilities:
   - Read `.crosspost-state.json` if it exists; else start empty.
   - Walk `src/content/blog/*.md`. For each post where `draft !== true` and `crosspost.devto !== false`:
     - Compute SHA-256 of `body + frontmatter` (canonical-stringified). If unchanged from state, skip.
     - Build payload: `title`, `body_markdown` (with image URLs absolutized and any `<Comments />`-style components stripped), `description`, `tags` (first 4), `canonical_url` (full ii4ki.github.io URL), `published: true`, `series` if present.
     - If state has `devto.id` for this slug → `PUT /api/articles/{id}`; else `POST /api/articles`.
     - On success: update state entry with new `id`, returned `url`, ISO timestamp, and content hash.
     - On `429`: backoff 60s and retry once; on second `429`, write the partial state and fail the job. Do not silently drop posts.
   - Write `.crosspost-state.json` back.
3. **Add `.github/workflows/crosspost.yml`.**
   - Triggers: `push` to `main` with changes under `src/content/blog/**`, plus `workflow_dispatch` with optional `slug` input for manual re-runs.
   - Permissions: `contents: write` (to commit state file back).
   - Steps: checkout (`fetch-depth: 0` so commit auth works), setup-node, `npm ci`, run script, `git add .crosspost-state.json && git commit -m "chore(crosspost): sync state [skip ci]" && git push` only if the file changed.
   - Pin action SHAs — same as the other workflows.
4. **Update `CLAUDE.md`** with a one-line note: `.crosspost-state.json` is owned by CI; don't edit by hand.
5. **Smoke test:**
   - Add a tiny test post `src/content/blog/__crosspost-smoke.md` with `draft: false` and `crosspost.devto: true`.
   - Trigger workflow_dispatch. Confirm article appears on dev.to, canonical_url is correct, state file is committed.
   - Edit the body, push. Confirm same article ID updated, no duplicate.
   - Set `crosspost.devto: false`, push. Confirm the existing article is **not** unpublished — opt-out only governs future syncs, not retroactive deletion. (Document this explicitly in `CLAUDE.md`.)
   - Delete the smoke post + state entry.

### Pros and cons of stage 6

**Pros**
- Reach without writing twice.
- SEO stays on the primary domain.
- State machine is small and inspectable in version control.

**Cons / risks**
- dev.to rate limit is undocumented — if it tightens, the workflow needs a queue. Acceptable risk at the volume of one or two posts a week.
- One more workflow to keep dependabot-current.
- Tag policy mismatch can surface as 422 errors. Mitigation: the script logs each request body on failure.
- If `.crosspost-state.json` is ever destroyed or corrupted, the next run will create duplicate articles. Mitigation: the file is versioned; rolling back the commit recovers state. Also: a flag `--dry-run` on the script prints what it would do without calling the API.

### Sources for stage 6

- [Forem API — articles](https://developers.forem.com/api/v1)
- [Update article reference](https://developers.forem.com/api/v1#tag/articles/operation/updateArticle)
- [Swyx: using dev.to as a CMS (2021 retro)](https://www.swyx.io/devto-cms) — note the explicit "I no longer recommend this for CI" caveat; it informed the content-hash skip logic above.
- [Publishing to dev.to programmatically in 2026](https://dev.to/ankitg12/publishing-to-devto-programmatically-in-2026-what-actually-works-2nkd)
- [Blog syndication best practices (2026)](https://www.nvarma.com/blog/2026-02-10-cross-publishing-blog-posts-devto-hashnode-medium)
- [Draft.dev — syndicating developer content](https://draft.dev/learn/syndicating-developer-content)

---

## C. Stage 7 — Email newsletter via Resend (free tier) — **DEFERRED**

> **Status:** deferred until there's a real subscriber signal (decided 2026-05-17).
> Standing up a list with zero waiting demand is wasted setup — domain reputation accumulates from real sends, not from empty audiences. Revisit when there's organic demand (asks in comments, repeat readers in analytics, or first dev.to/HN-driven traffic). Plan kept fully specified below so it's drop-in when triggered.

### Goal

A `Subscribe` form on the blog. Confirmed subscribers receive an email each time a new post lands. Templates are React Email components; broadcasts are scheduled by an Action; everything runs on Resend's free tier.

### Free-tier accounting

| Limit | Free tier | What it means here |
|---|---|---|
| Transactional emails | 100/day, 3,000/month | Covers double-opt-in confirmations and welcome emails. Broadcasts don't count against this. |
| Marketing contacts | 1,000 | Hard ceiling on audience size. At 1,001 the next signup is rejected. We surface this in the worker logs and ignore it until we hit 800. |
| Broadcasts | Unlimited sends, gated only by contact count | One broadcast per new post = trivial. |
| Verified domain | 1 | Use `mail.ii4ki.com` (or wherever — see DNS note below) as the From domain. |
| Data retention | 30 days | Logs and event history only — does not delete contacts. Worth noting for debugging windows. |
| Automation runs | 10,000/month | Plenty for a manual-trigger broadcast workflow. |

If signups exceed 1,000 → either pay or cull. Cull is fine; this is a personal blog.

### Three options for the architecture, with tradeoffs

```
                  ┌──────────────────────────────────────────┐
Option A          │  Static form → Resend Audiences direct   │
(simplest)        └──────────────────────────────────────────┘
                  No worker; submit form straight from JS to api.resend.com.
                  REJECTED — would leak the Resend API key in client JS.
                  No way to do this securely without a backend.

                  ┌──────────────────────────────────────────┐
Option B          │  Static form → CF Worker → Resend        │  ← RECOMMENDED
(recommended)     └──────────────────────────────────────────┘
                  Subscribe form posts to a Worker at api.ii4ki.com/subscribe.
                  Worker validates, hits Resend Contacts API, optionally sends
                  a double-opt-in email via Resend Emails API. Confirm link
                  hits a second worker route which flips unsubscribed:false.

                  ┌──────────────────────────────────────────┐
Option C          │  Static form → Formspree/etc → webhook   │
(deferred)        └──────────────────────────────────────────┘
                  Use a no-code form service that emits a webhook to a worker.
                  Adds a dependency for no real benefit; Option B is one worker
                  either way. Skip.
```

### Components needed (Option B, exhaustive list)

1. **Domain for sending.** Pick a subdomain you control DNS for. Cheapest: `mail.ii4ki.com` if `ii4ki.com` is yours; else punt and use `ii4ki.dev` or similar. Add the SPF/DKIM/DMARC records Resend gives you on the Domains page. Verification typically takes 5–15 minutes.
2. **Resend audience.** Create one audience `ii4ki.com main list`. Note its UUID — gets stored as a worker env var.
3. **Cloudflare Worker `ii4ki-subscribe`.** Three routes:
   - `POST /subscribe` — body `{ email }`. Validates with a regex (RFC-lite, not RFC-perfect), rate-limits per IP via Workers KV (5/hour/IP), creates a contact in the audience with `unsubscribed: true`, sends double-opt-in email via Resend with a signed JWT in the confirm URL. Returns 200 with neutral copy ("If you haven't subscribed yet, check your inbox") — never confirms whether the address is new, to avoid leaking subscriber list.
   - `GET /confirm?token=...` — verifies JWT, flips contact to `unsubscribed: false`, redirects to `https://ii4ki.github.io/subscribed`.
   - `GET /unsubscribe?token=...` — verifies JWT, sets `unsubscribed: true`, redirects to `https://ii4ki.github.io/unsubscribed`. (Resend also injects its own unsubscribe link per CAN-SPAM — both should work.)
4. **Worker secrets.** `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, `JWT_SECRET`. Set via `wrangler secret put`.
5. **Worker code lives in `content-creator` or a new tiny repo?** Recommend new repo `ii4ki/ii4ki-workers` (public). One worker, one folder, deployed by its own GH Action. Keeps the blog repo focused on content; keeps the content-creator repo focused on authoring.
6. **React Email templates** (also in `ii4ki-workers`):
   - `ConfirmSubscription.tsx` — single CTA: "confirm subscription," explains why you're getting it, signed off in the ii4ki voice.
   - `Welcome.tsx` — sent after confirm. One-time. Mentions cadence (irregular, only when there's an actual post).
   - `Broadcast.tsx` — used by the post-broadcast workflow. Takes `{ title, description, slug, pubDate, body_html }` props.
   - `Goodbye.tsx` — optional; sent on unsubscribe. Probably skip — silence is more respectful than a "sorry to see you go" email.
7. **Astro `<Subscribe />` component.** Plain `<form>` with `fetch()` POST; no client JS framework. Honeypot field + `Content-Type: application/x-www-form-urlencoded` so submission works even with JS disabled (degrade gracefully — Worker handles both). Drop it on `/`, `/blog`, and at the end of every post.
8. **`/subscribed` and `/unsubscribed` pages.** Static `.astro` pages in the same shell as the rest of the site. No tracking, no follow-up CTAs.
9. **Broadcast workflow `.github/workflows/broadcast.yml`** in the blog repo:
   - Trigger: `workflow_dispatch` with input `slug` (manual trigger from Actions UI). **Do not auto-send on push.** A blog post going live and the newsletter announcing it should be two distinct human decisions.
   - Steps: read the post Markdown, render to HTML using the same Astro pipeline as the site (`astro build` then read `dist/blog/<slug>/index.html` body), strip the chrome, inject into the `Broadcast.tsx` template via React Email's `render()`, call Resend Broadcasts API to **create** the broadcast (don't send). Workflow output: the broadcast preview URL on resend.com.
   - Manual final step: hit "Send" in the Resend dashboard after eyeballing the preview. This is on purpose — the "create draft, never auto-send" pattern means you can always pull the cord.

### Workflow shape, end-to-end

```
Author flow (no change from today):
  cc-draft blog → review → cc-publish <slug> → git push

Cross-post flow (stage 6, automated):
  push triggers crosspost.yml → POST or PUT dev.to → commits state file

Newsletter flow (stage 7):
  Reader: form on blog → POST worker /subscribe → confirm email →
          click link → GET worker /confirm → unsubscribed:false
  Author: trigger broadcast.yml with slug → workflow builds React Email →
          POST Resend Broadcasts (status:draft) → human reviews → human clicks send
```

### Implementation order

7a. **Domain + audience.** No code. Just DNS records and a Resend dashboard tour. ~30 min.
7b. **Worker `POST /subscribe` only** — creates a contact, no double opt-in yet. Confirm via Resend dashboard that contacts appear. ~1 hour.
7c. **Add double opt-in** — JWT-signed confirm link, `GET /confirm` route, ConfirmSubscription template. ~2 hours.
7d. **Add `<Subscribe />` to the blog**, plus `/subscribed` and `/unsubscribed` pages. End-to-end smoke from real browser → real inbox. ~1 hour.
7e. **Welcome template + send on confirm.** ~30 min.
7f. **`broadcast.yml` workflow.** First broadcast goes to a test audience with one address (your own). After that, point at the real audience. ~3 hours including template polish.
7g. **Add unsubscribe route + the link in templates.** Resend's automatic unsubscribe header is good but a visible link in the email body is the courteous default. ~1 hour.

Total: roughly one weekend of work, spread however.

### Pros and cons of stage 7

**Pros**
- Owned channel. No platform algorithm between you and readers.
- Free at this scale.
- React Email + Resend = templates live in code, versioned, reviewable.
- Double opt-in keeps the list clean and avoids deliverability spirals.

**Cons / risks**
- **Domain reputation.** A brand-new sending domain has zero reputation. First few sends may land in Promotions or Spam in Gmail. Mitigation: send the welcome email immediately on confirm (warms the relationship with the inbox) and start broadcasts only after 20+ confirmed contacts.
- **1,000-contact ceiling.** Personal blog — fine for years. Worth a calendar reminder once we cross 800.
- **Worker is now a thing to maintain.** Dependabot-equivalent for Wrangler/CF SDK is `renovate.json`. One more surface area.
- **Deliverability debugging is not fun.** If broadcasts start bouncing, the 30-day retention on logs is uncomfortably short. Document the symptoms in `CLAUDE.md` of the workers repo when they happen.
- **Resend doesn't do segmentation or automations on free tier well.** Acceptable — we want broadcasts only.

### Sources for stage 7

- [Resend pricing](https://resend.com/pricing) — free-tier details
- [Resend — Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction)
- [Resend — Audiences](https://resend.com/docs/dashboard/audiences/introduction)
- [Resend — Create contact API](https://resend.com/docs/api-reference/contacts/create-contact)
- [Cloudflare tutorial: Astro + Resend form submissions](https://developers.cloudflare.com/developer-spotlight/tutorials/handle-form-submission-with-astro-resend/)
- [`notrab/resend-newsletter-starter`](https://github.com/notrab/resend-newsletter-starter) — uses Astro Actions; not what we want here (we have static GH Pages, not Astro on a server), but the Zod validation and double-opt-in patterns transfer.
- [`pruthivithejan.me` — Building a newsletter with Resend](https://pruthivithejan.me/blog/building-a-newsletter-with-resend-api/)

---

## D. Stage 8 — Search, OG, comments, and small wins

Refined versions of the items that were stage 6 in the original plan, with sharper scope and tradeoffs.

### 8.1 Pagefind search (~2 hours)

The right call. Algolia is overkill, paid, and unnecessary; Pagefind is built for exactly this.

**Steps:**
1. `npm install -D pagefind`.
2. Add a post-build step in `_build.yml`: `npx pagefind --site dist`.
3. New component `src/components/Search.astro` mounting `pagefind-ui` from `/pagefind/pagefind-ui.js`. Lazy-loaded behind a `Ctrl+K` / `⌘K` keybinding; otherwise the UI doesn't render.
4. Theme the result UI with the same CSS custom properties as the rest of the site (`--accent`, `--green`, `--muted`).

**Pros:** zero ongoing cost, no network round-trip, ~100KB index for this corpus, works offline once visited.
**Cons:** typo tolerance is weaker than Algolia. For a blog this size it doesn't matter.

Sources: [Pagefind docs](https://pagefind.app/), [Starlight uses Pagefind by default](https://starlight.astro.build/guides/site-search/), [search engine comparison](https://sarthakmishra.com/blog/astro-search-comparison).

### 8.2 OG images via Satori (~3 hours)

**Steps:**
1. `npm install -D satori @resvg/resvg-js` (the JS build, not WASM — we run on Linux runner with full Node, sharp is already a dependency).
2. New file `src/pages/og/[...slug].png.ts` — a dynamic route returning a PNG. Astro 6 supports this via `getStaticPaths` for prerender. For every post, emit `og/<slug>.png` at build.
3. Pull the "OG image template" CD already produced (per the original plan's Stage 0 design assets) and port to Satori JSX. Satori only supports flexbox, no grid or absolute positioning — verify CD's template doesn't use them.
4. Update `<BaseHead />` to set `<meta property="og:image" content="https://ii4ki.github.io/og/<slug>.png" />` and `twitter:card`.

**Pros:** sharable links look like a designed site, not a fallback favicon. Free, build-time, no third-party.
**Cons:** rebuild time goes up by ~50ms per post; negligible until ~500 posts. Satori's flexbox-only constraint can frustrate designers.

Sources: [astro-satori](https://github.com/kevinzunigacuellar/astro-satori), [dietcode.io build-time OG guide](https://dietcode.io/p/astro-og/), [Jilles Soeters — build vs runtime tradeoffs](https://jilles.me/og-images-astro-build-vs-runtime/).

### 8.3 Giscus comments — ✅ DONE (2026-05-17)

Shipped in commit `189285e`. Wiring:

- `src/components/Comments.astro` mounts the giscus client lazily via `IntersectionObserver` (200px rootMargin) and bridges the site theme toggle to the iframe via a `MutationObserver` on `<html>[data-theme]` + `setConfig` postMessage.
- Mapping: `pathname`, `data-strict="1"`. Category: `Announcements` (existing, type Announcement — only maintainers/giscus can open new threads).
- Custom theme files at `public/giscus-dark.css` and `public/giscus-light.css` map Primer/giscus CSS variables onto ii4ki tokens; JetBrains Mono inside the iframe; all `border-radius: 0` to match the site's squared corners.
- giscus GitHub App installed on the `ii4ki` org, scoped to this repo only.

**Pros:** free, no DB, comments are GitHub Discussions threads you already have notifications for.
**Cons:** requires a GitHub account to comment. Acceptable for a dev-audience blog.

### 8.4 Code copy buttons — ✅ DONE (2026-05-17)

Shipped alongside a broader code-block polish pass. Wiring:

- `src/plugins/rehype-code-copy.mjs` wraps every Markdown `<pre>` in a `.code-wrap` container with a `.code-toolbar` row: `.code-lang` (left, reads `data-language` from Shiki's pre output) + `.code-copy` button (right).
- Delegated click handler at the bottom of `Post.astro` reads `pre.innerText` at click time (no source duplication into HTML) and flips `data-state` between `copied` (green) / `error` (red) for ~1.6s.
- Custom dual Shiki themes at `src/themes/shiki-ii4ki.mjs` map only the site's 3 syntax-token colors (`--dim` comments, `--accent` keywords/keys/builtins/vars, `--muted` strings). Light/dark swap via `--shiki-light` CSS variables.
- Prose spacing tightened around block elements: `.prose > * + pre/blockquote/.code-wrap` and the reverse pair now use 1.8em instead of the universal 1.1em — paragraphs still get 1.1em; headings/`hr` keep their existing larger margins.
- Blockquote left border bumped to **2px `var(--accent)`** so callouts read as callouts.
- Giscus loading state turned into a three-step machine (`false` → `pending` → `ready`) so the loading placeholder stays visible until the iframe `load` event fires.

**Pros:** UX upgrade users notice within ten seconds. Code blocks now blend with the site palette instead of importing GitHub Dark's foreign colors.
**Cons:** none worth mentioning.

### 8.5 `/now` page (~30 min)

New route `src/pages/now.astro` rendering `src/content/meta/now.md`. Manual update cadence (weekly-ish). Schema isn't worth a collection for one file.

**Pros:** "now" pages are a small, well-loved web tradition (nownownow.com directory). Signals you're a person, not a content farm.
**Cons:** if you stop updating it, it becomes a liability. Acceptable risk.

### 8.6 Analytics — ✅ DONE (Umami)

Already provisioned with Umami before this plan was written. Privacy-friendly, no cookie banner needed, script tag already in `Base.astro`. No further action; do not add Plausible/GoatCounter/GA on top.

### 8.7 Lighthouse CI (~1 hour, but don't gate on it for the first month)

Add `lighthouse-ci.yml` on PRs. Perf floor 95 desktop, 90 mobile. **Warning-only for first month** — collect a baseline, then turn on gating. The point is to catch a regression, not to make the first run blocking.

---

## E. Stage 9 — Quality and reach (month 2+)

These are smaller and more diffuse — sequence as you feel like it.

### 9.1 Webmentions

Receive mentions via webmention.io (free), display inline below comments. Send mentions via [webmention-cli](https://github.com/remy/webmention.io-tools) as a post-deploy step in `deploy.yml`. Indieweb-correct. ~2 hours.

**Pros:** decentralized cross-blog conversation. Lights up when other indieweb folks link to you.
**Cons:** receive volume on a small blog is near zero. Mostly a signal-of-care thing.

### 9.2 JSON Feed alongside RSS

`/feed.json` in addition to `/rss.xml`. ~30 min — Astro RSS plugin emits both. Modern feed readers prefer JSON; some bots only consume one.

### 9.3 Per-tag RSS feeds

`/tags/<tag>.xml`. Niche but cheap. ~1 hour.

### 9.4 Series support

`series` field is already in the schema. New `/series/[name].astro` route, plus a series banner on individual posts. ~2 hours.

### 9.5 Vale prose linting

`vale` on PRs, style `write-good` or `Microsoft`. Annotate, don't block. ~1 hour. Risk: too noisy to be useful — try it on one PR, accept it or roll it back.

### 9.6 Weekly external link check

Lychee is already in `_build.yml` for internal links. New `link-check.yml` cron weekly, full external sweep, opens an issue per dead link batch. ~1 hour. Mitigate noise by allowlisting known-flaky domains in `lychee.toml`.

### 9.7 Edit-on-GitHub link per post

Small footer in `Post.astro`: `<a href="https://github.com/ii4ki/ii4ki.github.io/edit/main/src/content/blog/<slug>.md">edit on GitHub</a>`. ~10 min. Invites typo fixes from readers.

### 9.8 Last-updated badge

If `updatedDate` is set in frontmatter and differs from `pubDate`, render "Updated: <date>" near the post header. ~15 min. Already supported by the schema.

### 9.9 Print stylesheet

`@media print` block in `global.css`: hide nav/footer/comments, full-bleed `.prose`, drop the dark theme. ~30 min. Surprisingly useful for archival.

### 9.10 Reading position indicator

A 2px bar at the top of `<Post>` that fills as you scroll. ~30 min. Tasteful when paired with the terminal aesthetic. Optional.

### Indefinitely deferred

- **Auto-tweet / auto-Bluesky on publish.** Hard to do tastefully; social presence is healthier when posts get human framing.
- **Hashnode cross-post.** Add if audience overlap appears, not before.
- **AI-tag suggestions on PR.** Cute but the tag list is small enough to manage manually.
- **TIL section / micro-posts.** The blog already absorbs short posts. Don't fragment the surface.
- **Full-text email RSS digest.** Resend can do this with a cron-built broadcast, but the broadcast workflow in stage 7 already covers "email on new post." A separate digest is a second product.
- **Membership / paid tier.** Out of scope. The blog is a public record.

---

## F. Risks and recommendations across all stages

1. **Don't ship stages 6 and 7 the same week.** Stage 6 changes the publish surface (now Actions also commit to the repo). Stage 7 introduces a new external dependency (Resend) and a new worker. Land them one at a time so when something breaks you know which integration to look at. (Moot for now — Stage 7 is deferred.)
2. **Add a `make sync` / `npm run sync` escape hatch.** A one-liner that runs the cross-post script locally with `--dry-run` against a single slug. Useful when CI fails and you want to inspect the payload by hand.
3. **Keep `.crosspost-state.json` and `.broadcast-state.json` as separate files** if/when broadcasts get state too. Don't bundle. Single-purpose files are easier to bisect and recover.
4. **Pin every action SHA, like the existing workflows.** Dependabot updates them. No `@v4` shortcuts.
5. **Audit the `Subscribe` worker for abuse before going public.** Specifically: per-IP rate limit, honeypot field on the form, JWT confirm tokens with reasonable expiry (~24h). A spammy signup flood eats free tier and reputation.
6. **Pick one Resend sending domain and never change it.** Domain reputation accumulates. Rotating sending domains starts the warmup clock over.

---

## G. Updated lock list (delta from staged-plan.md §C)

| Decision | Locked answer |
|---|---|
| dev.to as a syndication target | Yes; canonical_url back to ii4ki.github.io |
| Hashnode / Medium | Deferred (Hashnode) / declined (Medium) |
| Cross-post state storage | Sidecar `.crosspost-state.json` at repo root, committed by CI |
| Per-post crosspost opt-out | `crosspost.devto: false` in frontmatter |
| Cross-post triggers | Push to main with `src/content/blog/**` changes, plus manual dispatch |
| Newsletter provider | Resend, free tier |
| Subscribe form backend | Cloudflare Worker in new repo `ii4ki/ii4ki-workers` |
| Double opt-in | Yes, JWT-signed confirm link |
| Broadcast trigger | Manual `workflow_dispatch` per post — draft created via API, human sends |
| Templates | React Email, lives in workers repo |
| Search | Pagefind, built into `_build.yml`, lazy-loaded behind `⌘K` |
| OG images | Satori at build time, prerendered per post |
| Comments | Giscus, lazy-loaded |
| Analytics | Umami (already in place); nothing heavier |
| Stage 7 (newsletter) timing | Deferred until reader signal — not on first execution pass |
| Stage 8 ordering | Giscus → Satori OG → code copy come first (decided 2026-05-17) |
| Lighthouse | Warning-only for first month, gate thereafter |

---

## H. Suggested execution order

Polish-then-amplify: every cross-posted article lands on a page that looks finished. The Stage 8 priorities are also the cheapest, highest-confidence wins.

```text
session 1   Stage 8.3 (Giscus)          — ✅ done 2026-05-17 (commit 189285e)
session 2   Stage 8.4 (copy buttons)    — ✅ done 2026-05-17 (also: custom Shiki themes, prose spacing, blockquote accent, Giscus load-state fix)
session 3   Stage 8.2 (Satori OG)       — port CD's OG template to JSX; ~3 hours
session 4   Stage 6   (dev.to crosspost) — sidecar state + workflow; ~3–4 hours
later       Stage 8.1 (Pagefind search) — once corpus has 5+ posts, otherwise search has nothing to find
later       Stage 8.5 (/now), 8.7 (Lighthouse), Stage 9.* — opportunistic
deferred    Stage 7   (Resend newsletter) — when reader signal appears
```

Why this order:

- **Giscus first** because the component already exists and the only cost is generating tokens and lazy-loading the script. Fastest visible win.
- **Code copy second** because every existing post benefits immediately, and it's a one-file rehype plugin.
- **OG images third** because they require porting the template and have the highest design fiddle factor. Doing them before dev.to crosspost means every syndicated link unfurls with the right card from day one.
- **dev.to fourth** because by the time you cross-post, the destination is polished, has comments, has copy buttons, has OG previews. The first wave of imported readers sees the finished thing, not the construction site.
- **Pagefind deferred** until there's a useful corpus — search on a 5-post blog is just a worse table of contents.

Stop at any session boundary. Nothing depends on the next item being done.
