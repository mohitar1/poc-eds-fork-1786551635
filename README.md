# Assets Hub Spark

Assets Hub Spark is a demo asset-sharing portal built on AEM Edge Delivery Services (Helix) & Content Hub (Dynamic Media) APIs.

## Environments

### Main site (cloudflare worker):
- Live: https://frescopamedia.com
- Preview: https://preview.frescopamedia.com
- Branch: <https://{branch}.dev.frescopamedia.com>

Note: For branch URLs to work, the branch names must be short and only include lowercase letters, numbers, and dashes characters. Due to [cloudflare worker alias limitations](https://developers.cloudflare.com/workers/configuration/previews/#rules-and-limitations).

### Helix origins
- Live: https://main--poc-eds-fork-1786551635--mohitar1.aem.live
- Preview: https://main--poc-eds-fork-1786551635--mohitar1.aem.page

## Project structure

This project is based on the [aem-boilerplate](https://github.com/adobe/aem-boilerplate) template and adds both React components and a Cloudflare worker.

List of projects, each with their own `package.json`:
- root - the AEM EDS main project
- [cloudflare](cloudflare): Cloudflare worker for the assets share portal

### AEM EDS

Before using the aem-boilerplate, we recommand you to go through the documentation on https://www.aem.live/docs/ and more specifically:

1. [Developer Tutorial](https://www.aem.live/developer/tutorial)
2. [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
3. [Web Performance](https://www.aem.live/developer/keeping-it-100)
4. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

### Asset Search Block

The asset search functionality is implemented as a vanilla JS EDS block in `blocks/search-results/`.

### Cloudflare Worker

A Cloudflare Worker is located in the [cloudflare](cloudflare) folder. This worker handles the site and sits in front of AEM Helix and Dynamic Media.

## Installation

Install npm dependencies for the root project and cloudflare worker:

```sh
npm install
```

This automatically installs cloudflare worker dependencies via the `postinstall` script.

### Cleanup

To cleanup the checkout (remove all `node_modules`, build and cache folders etc.) run this first in the root:

```sh
npm run clean
```

## Local development

### Initial setup

Add `cloudflare/.secrets` file with the [required secrets](cloudflare/README.md#secret-store), such as:

```
# Cookie authentication
# For local development, not the same as production. generate using `openssl rand -base64 32`
SPARK_COOKIE_SECRET="..."

# DM IMS technical account token
# Get from Adobe developer console project with access to AEM_ENV_ID delivery environment
SPARK_DM_CLIENT_ID="..."
SPARK_DM_CLIENT_SECRET="..."
```

### Run full stack locally

```sh
npm run dev
```

This should open <http://localhost:8787> in your browser. Use `Ctrl+C` to stop it.

This runs a local cloudflare worker (`wrangler dev`) and local EDS (`aem up`).

#### Running multiple instances

You can run multiple `npm run dev` instances simultaneously (e.g. from different git worktrees). The script auto-detects free ports when the defaults are taken:

| Service | Default | Fallback sequence |
|---------|---------|-------------------|
| AEM (`aem up`) | 3000 | 3001, 3002, 3003, ... |
| Wrangler | 8787 | 9001, 9002, 9003, ... |
| Inspector | 9229 | 9301, 9302, 9303, ... |

The resolved ports are printed at startup. When running from a worktree, the `.secrets` file is automatically symlinked from the main checkout.

Note you will need to stop and restart `npm run dev` after 24 hours to renew the DM IMS technical account token.

Environment variables supported by `npm run dev`:

| Variable | Description | Default |
|----------|-------------|---------|
| `AEM_PAGES_URL` | EDS content URL | https://main--poc-eds-fork-1786551635--mohitar1.aem.page |
| `AEM_ENV_ID` | AEM Program + Environment ID | p203220-e2129061 |
| `DEV_BROWSER` | Browser to open. Mac OS only.<br><br>Options:<ul><li>`Google Chrome`</li><li>`Safari`</li><li>`Firefox`</li></ul> | - (system default) |
| `AEM_LOG_LEVEL` | Set [`aem` log level](https://www.aem.live/developer/cli-reference#general-options). | `info` |
| `CLOUDFLARE_LOG_LEVEL` | Set [wrangler dev --log-level](https://developers.cloudflare.com/workers/wrangler/commands/#dev). Maps to `console.<level>()` in js. <br><br>From most to least verbose: <ul><li>`debug` (avoid, very noisy with internals)</li><li>`log`</li><li>`info`</li><li>`warn`</li><li>`error`</li><li>`none`</li></ul> | `info`<br><br> This hides `console.log` output, but works well if you treat `console.log` as "debug" level that should be hidden by default from local output. Then use `console.info` for your test logs you want to see immediately.  |
| `CLOUDFLARE_REQUEST_LOGS` | Set to `1` to show request logs from cloudflare worker, which is the default behavior of `wrangler dev` but we turn it off to keep things readable.<br><br> Example request log:<br>`[wrangler:info] GET /path 200 OK (10ms)` | - (off) |

### Troubleshooting: Ports still open

If after quitting `npm run dev` the ports on localhost are still in use because processes are left behind, run this:

1. List processes from this script:
   ```sh
   ps x | grep -vF grep | grep -E "(local.sh|wrangler|chokidar|aem up)"
   ```

2. Kill these processes:
   ```sh
   ps x | grep -vF grep | grep -E "(local.sh|wrangler|chokidar|aem up)" | awk '{print $1}' | xargs kill
   ```

## Local Notes Directory

The `.internal/` directory is git-ignored and available for engineers to keep local context notes, scratch files, planning docs, or any other private files that shouldn't be committed. Create this directory as needed:

```sh
mkdir .internal
```

## Linting

Should work in each project folder:

```sh
npm run lint
```

## Testing

Should work locally from root and cloudflare folder:

```sh
npm run test
```

Test will also run during PR builds.


## SonarQube

SonarQube analysis is configured in [sonar-project.properties](sonar-project.properties).
Project on Hosted instance can be found at https://aem-assets.cq.corp.adobe.com/dashboard?id=spark

To run full project analysis and update hosted report, run from root:

Requires sonar token in env  
export SONAR_TOKEN=your_token

```sh
npm run sonar
```
To run full branch analysis and update hosted branch report, run from root.
This will automatically detect the current branch name and compare against main and show only new issues introduced in the branch.

```sh
npm run sonar:branch
```

## CI/CD

[Github actions](.github/workflows/) build & lint the project, and automatically [deploy the cloudflare worker](cloudflare/README.md#deploying). They also automatically rotate secrets (running on a cron schedule).

Github actions must be configured with these [secrets](cloudflare/README.md#ci-secrets) and [variables](cloudflare/README.md#ci-variables).

