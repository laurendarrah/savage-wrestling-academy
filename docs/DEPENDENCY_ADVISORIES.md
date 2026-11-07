# Dependency advisories

What `pnpm audit` reports, what was fixed, and why anything left over is acceptable. Update this file whenever an
upgrade or override changes the picture.

Last checked: November 7, 2026 (issue #48).

| | Low | Moderate | High | Total |
|---|---|---|---|---|
| `pnpm audit` before #48 | 7 | 27 | 28 | 62 |
| `pnpm audit` after #48 | 0 | 3 | 0 | 3 |
| `pnpm audit --prod` (before and after) | 0 | 0 | 0 | 0 |

## Read this first: `--prod` does not cover everything that ships

`pnpm audit --prod` only looks at `dependencies`. vinext, `@vitejs/plugin-rsc` and `react-server-dom-webpack` are
`devDependencies`, but parts of them are bundled into the Worker in `dist/server`, for example React's Server
Functions decoder (`decodeReply`). When triaging an advisory in one of these three packages, treat it as production
until the built Worker shows otherwise. Search `dist/server` for code from the package.

vinext also vendors some dependencies inside its own `dist/deps` folder (image-size from 1.0.0-beta.6 on).
`pnpm audit` cannot see vendored copies, so a vinext upgrade can make an advisory disappear without fixing it. Check
`node_modules/vinext/dist/deps/.pnpm/` after any vinext upgrade.

## What #48 fixed

One package per commit, each followed by `pnpm test`, `pnpm typecheck` and `pnpm build`. The browser walkthrough
(`pnpm e2e`) was run after the vite upgrade and again at the end.

| Change | How | Advisories fixed |
|---|---|---|
| eslint 9.39.4 → 9.39.5 | patch upgrade; pulls js-yaml 4.1.1 → 4.3.2 | js-yaml: 3 high, 1 moderate |
| brace-expansion 1.1.14 → 1.1.21 | lockfile refresh inside minimatch 3's existing `^1.1.7` | brace-expansion: 5 high, 1 moderate (1.x copy) |
| brace-expansion 5.0.6 → 5.0.12 | override `brace-expansion@5` (patch) | brace-expansion: 5 high, 1 moderate (5.x copy) |
| wrangler 4.92.0 → 4.154.0 | minor upgrade; miniflare now ships undici 7.30.1, ws 8.21.0 | (counted with the next row) |
| @cloudflare/vite-plugin 1.37.1 → 1.66.0 | minor upgrade, the release paired with wrangler 4.154.0 | undici: 10 high, 14 moderate, 5 low; ws: 1 high, 1 moderate; esbuild (Windows dev server): 1 low |
| vite 8.0.13 → 8.1.6 | minor upgrade, smallest release with every fix | vite: 1 high, 5 moderate, 1 low |
| react, react-dom, react-server-dom-webpack 19.2.6 → 19.2.8 | patch upgrade; the three must match | react-server-dom-webpack: 1 high (ships in the Worker) |
| image-size 2.0.2 → 2.0.4 under vinext | override `vinext>image-size` (patch) | image-size: 2 high |
| fflate 0.7.4 → 0.7.5 | lockfile refresh inside `@shuding/opentype.js`'s existing `^0.7.3` | fflate: 1 moderate |

Notes for reviewers:

- **React is a production dependency.** It is the only runtime change. `react-server-dom-webpack` 19.2.8 has a peer
  requirement of react and react-dom ^19.2.8, and the advisory affects code that ships, so all three moved by one patch.
- **wrangler is also the deploy tool.** The Deploy workflow runs it for the pre-deploy backup export, the D1 migrations
  and the deploy. The workflow itself is unchanged. Since 4.117 every wrangler 4.x release uses miniflare 5 (a
  pre-release version that wrangler pins itself); miniflare only runs the local dev server and the e2e walkthrough. Watch
  the first Deploy run after merging.
- wrangler 4.154.0 lists `@cloudflare/workers-types` ^5 as an optional peer. The repo keeps 4.x for its own typecheck.
  wrangler does not need it at runtime, so `pnpm peers check` shows this one warning. Moving to workers-types 5 is a
  separate major upgrade.
- vite 8.1 brings rolldown 1.1.5, which bundles the Worker, so the chunk layout in `dist/server` changed.
- vinext was not upgraded. From 1.0.0-beta.6 to 1.3.0 it vendors the vulnerable image-size 2.0.2 inside its own
  `dist`. The first release that ships a fixed copy (1.3.1) needs React 19.3 and changes production caching
  behaviour. That is a framework upgrade with its own testing, not a dev-tooling patch. The override fixes the
  advisory today.

### Overrides added (in `pnpm-workspace.yaml`)

| Override | Why | Remove when |
|---|---|---|
| `'brace-expansion@5': 5.0.12` | minimatch 10 allows `^5.0.5`, but `pnpm update` keeps 5.0.6 | typescript-eslint pulls a minimatch that requires brace-expansion ≥ 5.0.12 |
| `'vinext>image-size': 2.0.4` | vinext 1.0.0-beta.5 pins exactly 2.0.2 | vinext is upgraded (from beta.6 on it no longer depends on image-size; it vendors it) |

Both are patch-level, same major as the dependent asks for. pnpm applies the overrides in `pnpm-workspace.yaml`. The
`overrides` block in `package.json` uses npm's format and was left unchanged; for example, it still says fast-uri 3.1.8
while 3.1.9 is installed.

## What remains (3 moderate, all dev-only)

| Advisory | Package and path | Why it is acceptable | Fixed by |
|---|---|---|---|
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99): any website can read responses from esbuild's development server | esbuild 0.18.20 via drizzle-kit 0.31.10 → @esbuild-kit/esm-loader → @esbuild-kit/core-utils | The flaw is in esbuild's `serve` API. @esbuild-kit only calls `transform`/`transformSync` to load the Drizzle config when someone runs `pnpm db:generate` locally. No server is started, and nothing from drizzle-kit is in the Worker. | Blocked. drizzle-kit 0.31.11, the newest stable release, still depends on @esbuild-kit. An override from 0.18 to 0.25 would cross breaking 0.x versions. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch DoS through glob pattern amplification | minimatch 10.2.5 via eslint-config-next → typescript-eslint → @typescript-eslint/typescript-estree | Only the linter uses it, on glob patterns written in this repo. Lint is not part of CI or the build. | Blocked. The fix is minimatch 11 (a major), and the newest typescript-estree (8.72.1) still asks for `^10.2.2`. |
| [GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp): Satori-generated SVG has improper escaping | satori 0.16.0 via vinext 1.0.0-beta.5 → @vercel/og 0.8.6 | Satori backs `next/og` (`ImageResponse`). The app never imports `next/og`, so satori is never loaded and is not in the Worker bundle. | A vinext upgrade (1.0.0-beta.13 and later use @vercel/og 1.0.3 with satori 0.33.5). An override from 0.16 to 0.33 would cross breaking 0.x versions. |

## Other follow-ups noticed

- eslint 9.x is end-of-life (pnpm marks 9.39.5 deprecated). eslint 10 is a major upgrade with flat-config changes.
- `pnpm lint` reports 345 existing findings on `main`. Lint is not part of CI.

## Checking again

```sh
pnpm install --frozen-lockfile
pnpm audit                 # everything, including dev tooling
pnpm audit --prod          # what CI checks
pnpm why <package>         # which top-level dependency pulls a package in
```

Upgrade one package at a time, as CLAUDE.md says, and rerun `pnpm test`, `pnpm typecheck` and `pnpm build` after each
one. For vite, vinext, wrangler or the Cloudflare plugin, also run the walkthrough on free ports, for example
`E2E_PORT=8911 E2E_AUTH_PORT=54911 E2E_USAW_PORT=54921 pnpm e2e`.
