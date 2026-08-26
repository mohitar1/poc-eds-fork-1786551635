/**
 * Controller for the asset-enrichment agent (plan §1.4). Wires discovery -> read ->
 * generate -> normalize -> write -> publish -> report, with a --dry-run that stops before
 * any write. Dependency-injected (`client`, `generator`, `log`) so the flow is testable
 * without live network or credentials; the CLI bootstrap at the bottom supplies the real
 * implementations.
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { enumerateFolder } from './enumerate.js';
import { getAssetMetadata, isAlreadyEnriched } from './metadata.js';
import { fetchRenditionBytes, isImageFormat } from './rendition.js';
import { normalizeGenerated } from './normalize.js';
import { buildMetadataCsvBatches } from './csv.js';
import { buildMetadataPatch } from './json-patch.js';
import { submitMetadataImport, pollMetadataImportJob } from './write-bulk.js';
import { writeAssetViaPatch } from './write-patch.js';
import { publishAssets } from './publish.js';
import { Report, OUTCOME } from './report.js';
import { createDryRunGenerator } from './generate.js';
import { ImsTokenProvider, StaticTokenProvider } from './ims-auth.js';
import { AuthorClient } from './author-client.js';
import { ClassicAuthorClient } from './classic-client.js';
import { enrichAssetsClassic } from './enrich-classic.js';
import { createFixtureClient } from './fixture-client.js';
import { STATUS_APPROVED, buildHosts, buildAuthorHost } from './constants.js';
import { mapWithConcurrency } from './concurrency.js';
import {
  parseArgs, validateOptions, resolveCreds, resolveImsToken, resolveAemEnvId,
} from './config.js';

export { mapWithConcurrency };

/** Map normalized fields + scope onto a CSV row. */
function toCsvRow(asset, fields, scope) {
  return {
    assetPath: asset.repoPath,
    assetId: asset.assetId,
    title: fields.title,
    description: fields.description,
    keywords: fields.keywords,
    productCategory: fields.productCategory,
    campaign: fields.campaign,
    channel: fields.channel,
    brand: fields.brand,
    company: scope.company,
    status: scope.status,
  };
}

/**
 * Plan one asset: read metadata, skip if already enriched, fetch a rendition, generate +
 * normalize. Returns { asset, skip } or { asset, etag, fields }.
 */
async function planAsset({
  client, asset, generator, customerKey, force,
}) {
  const meta = await getAssetMetadata(client, asset.assetId);
  if (!force && isAlreadyEnriched(meta.assetMetadata, customerKey)) {
    return { asset, skip: true };
  }
  const dcFormat = meta.repositoryMetadata['dc:format'];
  let renditionBytes = null;
  if (isImageFormat(dcFormat)) {
    const rendition = await fetchRenditionBytes(client, asset.assetId).catch(() => null);
    renditionBytes = rendition?.bytes || null;
  }
  const hints = {
    machineKeywords: meta.assetMetadata['xcm:machineKeywords'],
    repoName: asset.repoName,
    dcFormat,
  };
  const raw = await generator({
    assetId: asset.assetId, repoName: asset.repoName, hints, renditionBytes,
  });
  const fields = normalizeGenerated(raw, {});
  return { asset, etag: meta.etag, fields };
}

/**
 * Run the enrichment flow.
 * @returns {Promise<{ report: Report, dryRun: boolean, csvPreview?: string }>}
 */
export async function enrichAssets({
  options, client, generator, log = console,
}) {
  const report = new Report();
  const { customerKey } = options;
  const scope = { company: customerKey, status: STATUS_APPROVED };
  const folderPath = options.damPath || `/content/dam/${customerKey}`;

  log.info?.(`[agent] enrich customer=${customerKey} folder=${folderPath} dryRun=${options.dryRun}`);

  // [1..3] Discover
  const {
    assets, scanned, matched, exceededWindow,
  } = await enumerateFolder({ client, folderPath });
  log.info?.(`[agent] scanned ${scanned} repo assets, ${matched} under ${folderPath}`);
  if (exceededWindow) {
    log.warn?.(`[agent] hit the scan cap before exhausting the repo — some assets under ${folderPath} may be missed; narrow with --dam-path`);
  }

  let targetAssets = assets;
  if (assets.length === 0) {
    if (options.bringIn) {
      log.warn?.('[agent] 0 assets found; bring-in lane requires scraped files (E3) — none provided here');
      return { report, dryRun: options.dryRun };
    }
    log.warn?.(`[agent] No assets found under ${folderPath} — nothing to enrich.`);
    return { report, dryRun: options.dryRun };
  }
  if (options.limit && Number.isFinite(options.limit)) {
    targetAssets = assets.slice(0, options.limit);
  }

  // [4] Read + generate + normalize (bounded concurrency)
  const planned = await mapWithConcurrency(
    targetAssets,
    options.concurrency,
    async (asset) => {
      try {
        return await planAsset({
          client, asset, generator, customerKey, force: options.force,
        });
      } catch (err) {
        report.record(asset.assetId, OUTCOME.FAILED, { stage: 'plan', error: String(err.message || err) });
        return { asset, error: err };
      }
    },
  );

  const enrichable = planned.filter((p) => p && p.fields && !p.skip);
  planned.forEach((p) => {
    if (p?.skip) report.record(p.asset.assetId, OUTCOME.SKIPPED, { reason: 'already-enriched' });
  });

  const rows = enrichable.map((p) => toCsvRow(p.asset, p.fields, scope));
  const csvBatches = buildMetadataCsvBatches(rows);
  const csvPreview = csvBatches.map((b) => b.csv).join('\n\n');

  // [5] Dry-run stops here
  if (options.dryRun) {
    log.info?.(`[agent] DRY RUN — would enrich ${enrichable.length} asset(s):`);
    log.info?.(csvPreview);
    enrichable.forEach((p) => report.record(p.asset.assetId, OUTCOME.ENRICHED, { dryRun: true }));
    return { report, dryRun: true, csvPreview };
  }

  // [5] Write
  if (options.writeMode === 'patch') {
    await mapWithConcurrency(enrichable, options.concurrency, async (p) => {
      const patchOps = buildMetadataPatch(p.fields, scope);
      const res = await writeAssetViaPatch({
        client, assetId: p.asset.assetId, patchOps, etag: p.etag,
      });
      if (res.ok) report.record(p.asset.assetId, OUTCOME.ENRICHED, { via: 'patch' });
      else report.record(p.asset.assetId, OUTCOME.FAILED, { stage: 'patch', status: res.status, error: res.error });
    });
  } else {
    for (const batch of csvBatches) {
      const submission = await submitMetadataImport(client, batch.csv, { waitSeconds: 0 });
      if (!submission.sync && submission.jobId) {
        await pollMetadataImportJob(client, submission.jobId).catch((err) => {
          log.warn?.(`[agent] import job poll failed: ${err.message}`);
        });
      }
    }
    enrichable.forEach((p) => report.record(p.asset.assetId, OUTCOME.ENRICHED, { via: 'bulk' }));
  }

  // [6] Publish
  if (!options.noPublish) {
    const enrichedIds = report.assets
      .filter((a) => a.outcome === OUTCOME.ENRICHED)
      .map((a) => a.assetId);
    if (enrichedIds.length > 0) {
      const { published } = await publishAssets(client, enrichedIds, {
        target: options.publishTarget,
      });
      log.info?.(`[agent] published ${published} asset(s) to ${options.publishTarget}`);
    }
  }

  return { report, dryRun: false, csvPreview };
}

/**
 * Rewrites `DEMO_COMPANY` in cloudflare/src/config.js to `customerKey`.
 * No-ops on dry runs or when the file cannot be found.
 * @param {string} customerKey
 * @param {{ dryRun?: boolean }} options
 */
function patchDemoCompany(customerKey, { dryRun = false } = {}) {
  if (dryRun) return;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(scriptDir, '../../cloudflare/src/config.js');
  if (!existsSync(configPath)) {
    console.warn('[agent] config.js not found — skipping DEMO_COMPANY patch');
    return;
  }
  const original = readFileSync(configPath, 'utf8');
  const patched = original.replace(
    /DEMO_COMPANY:\s*(?:null|'[^']*'|"[^"]*")/,
    `DEMO_COMPANY: '${customerKey}'`,
  );
  if (patched === original) {
    console.warn('[agent] DEMO_COMPANY already set correctly — no patch needed');
    return;
  }
  writeFileSync(configPath, patched, 'utf8');
  console.warn(`[agent] patched cloudflare/src/config.js → DEMO_COMPANY: '${customerKey}'`);
  console.warn('[agent] local dev server will pick this up automatically on next request');
  console.warn('[agent] to push to production: npm run deploy');
}

/** CLI bootstrap. */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const errors = validateOptions(options);
  if (errors.length > 0) {
    console.error(`Invalid arguments:\n  - ${errors.join('\n  - ')}`);
    process.exit(2);
  }

  const generator = createDryRunGenerator();

  // Dispatch to the right runner based on how credentials resolve:
  //  - --fixture: fully offline preview (converged fixture client, forced dry-run).
  //  - AUTHOR_SPARK_IMS_TOKEN present: the pre-issued bearer targets the CLASSIC AEM author
  //    API (Sling / Assets HTTP API). This is the live, working path — the converged
  //    /adobe/assets facade rejects this token's x-api-key (403003) and does not route
  //    publish/import, whereas the classic API authenticates the bearer with no key.
  //  - otherwise: the DM client_credentials flow against the converged API (documented
  //    fallback; requires the client id to be allowlisted for the environment).
  let run;

  if (options.fixture) {
    const assets = JSON.parse(readFileSync(options.fixture, 'utf8'));
    const client = createFixtureClient(assets);
    if (!options.dryRun) {
      console.warn('[agent] --fixture is offline-only; forcing --dry-run.');
      options.dryRun = true;
    }
    run = () => enrichAssets({ options, client, generator });
  } else {
    const preToken = resolveImsToken({ secretsFile: options.secretsFile });
    const aemEnvId = resolveAemEnvId({ aemEnvId: options.aemEnvId });

    if (preToken) {
      const tokenProvider = new StaticTokenProvider({ token: preToken.token });
      const client = new ClassicAuthorClient({
        tokenProvider, authorHost: buildAuthorHost(aemEnvId),
      });
      const apiKey = preToken.apiKey || null;
      const uploadStrategyName = apiKey ? 'repository' : 'classic';
      console.warn(`[agent] using pre-issued AUTHOR_SPARK_IMS_TOKEN from ${preToken.source}`);
      console.warn(`[agent] targeting AEM author env ${aemEnvId} uploadStrategy=${uploadStrategyName}`);
      run = () => enrichAssetsClassic({
        options, client, generator, apiKey, uploadStrategyName,
      });
    } else {
      let creds = null;
      try {
        creds = resolveCreds({ secretsFile: options.secretsFile });
      } catch (err) {
        if (options.dryRun) {
          console.error(
            `[agent] ${err.message}\n`
            + '[agent] --dry-run needs folder discovery, which requires credentials + network. '
            + 'Provide a pre-issued AUTHOR_SPARK_IMS_TOKEN or DM creds (env or cloudflare/.secrets) '
            + 'to preview against a real folder, pass --fixture <file.json> for a fully offline '
            + 'preview, or run the unit tests for offline verification of the pipeline logic.',
          );
          process.exit(2);
        }
        throw err;
      }
      const tokenProvider = new ImsTokenProvider({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      });
      const client = new AuthorClient({
        tokenProvider, clientId: creds.clientId, hosts: buildHosts(aemEnvId),
      });
      console.warn(`[agent] using DM creds from ${creds.source}`);
      console.warn(`[agent] targeting AEM author env ${aemEnvId} via the converged Assets API`);
      run = () => enrichAssets({ options, client, generator });
    }
  }

  const { report } = await run();

  // Surface per-asset failures on the CLI (not just in --report-file).
  const failures = report.assets.filter((a) => a.outcome === OUTCOME.FAILED);
  for (const f of failures) {
    const bits = [f.stage && `stage=${f.stage}`, f.status && `status=${f.status}`, f.error]
      .filter(Boolean)
      .join(' ');
    console.error(`[agent] FAILED ${f.assetId}: ${bits}`);
  }

  if (options.reportFile) {
    writeFileSync(options.reportFile, JSON.stringify(report.toJSON(), null, 2));
  }

  // Auto-scope the worker to this customer after a live enrichment run.
  if (!options.dryRun && options.customerKey) {
    patchDemoCompany(options.customerKey, { dryRun: false });
  }

  console.log(`[agent] done: ${report.summaryLine()}`);
  process.exit(report.exitCode());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const msg = err?.message || String(err);
    if (err && (err.status || err.responseBody || err.responseHeaders)) {
      const interesting = ['x-request-id', 'x-gw-ims-org-id', 'www-authenticate', 'content-type'];
      const hdrs = err.responseHeaders || {};
      const picked = interesting
        .filter((h) => hdrs[h] != null)
        .map((h) => `  ${h}: ${hdrs[h]}`)
        .join('\n');
      console.error('[agent] exact author API response:');
      if (err.status) console.error(`  status: ${err.status}`);
      if (picked) console.error(picked);
      console.error(`  body: ${err.responseBody || '(empty)'}`);
    }
    if (/not allowlisted/i.test(msg)) {
      console.error(
        '[agent] fatal: the AEM author API rejected this client ID as not allowlisted.\n'
        + '[agent] The IMS technical-account client ID must be allowlisted for this environment '
        + 'via the AEM Configuration Pipeline (cloud manager config, "api allowlist") before the '
        + 'author Assets HTTP API will accept it. Credentials and scopes are otherwise correct.',
      );
      process.exit(3);
    }
    console.error(`[agent] fatal: ${err.stack || msg}`);
    process.exit(1);
  });
}
