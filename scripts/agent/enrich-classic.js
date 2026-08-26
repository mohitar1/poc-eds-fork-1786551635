/**
 * Classic-API enrichment controller (plan §1.4), implemented on the Sling / Assets HTTP API
 * that the demo's bearer token can actually reach (see classic-client.js for the why).
 *
 * Flow: enumerate folder -> per asset {read metadata, idempotency skip, generate, normalize}
 * -> write via Sling POST -> publish via replication -> report. A --dry-run stops before any
 * write and prints the intended property set per asset. Dependency-injected (`client`,
 * `generator`, `log`) so it is unit-testable without live network.
 */

import {
  enumerateFolderClassic, getAssetMetadataClassic, writeAssetMetadataClassic,
  publishAssetsClassic,
} from './classic-assets.js';
import { createUploadStrategy } from './upload-strategy.js';
import { scrapeSiteImages } from './scrape-site.js';
import { isAlreadyEnriched } from './metadata.js';
import { normalizeGenerated } from './normalize.js';
import { Report, OUTCOME } from './report.js';
import { mapWithConcurrency } from './concurrency.js';
import { STATUS_APPROVED, FIELD } from './constants.js';

/** Map normalized generated fields + fork scope onto the AEM metadata property set. */
export function fieldsToProperties(fields, scope) {
  return {
    [FIELD.TITLE]: fields.title ?? null,
    [FIELD.DESCRIPTION]: fields.description ?? null,
    [FIELD.SUBJECT]: fields.keywords ?? null,
    [FIELD.PRODUCT_CATEGORY]: fields.productCategory ?? null,
    [FIELD.CAMPAIGN]: fields.campaign ?? null,
    [FIELD.CHANNEL]: fields.channel ?? null,
    [FIELD.BRAND]: fields.brand ?? null,
    [FIELD.COMPANY]: scope.company,
    [FIELD.STATUS]: scope.status,
  };
}

/** Read metadata, skip if already enriched, else generate + normalize. */
async function planAssetClassic({
  client, asset, generator, customerKey, force,
}) {
  const props = await getAssetMetadataClassic({ client, repoPath: asset.repoPath });
  if (!force && isAlreadyEnriched(props, customerKey)) {
    return { asset, skip: true };
  }
  const hints = {
    machineKeywords: props['xcm:machineKeywords'] || asset.halMetadata['dc:subject'],
    repoName: asset.repoName,
    dcFormat: props['dc:format'] || asset.halMetadata['dc:format'],
  };
  const raw = await generator({
    assetId: asset.assetId, repoName: asset.repoName, hints, renditionBytes: null,
  });
  const fields = normalizeGenerated(raw, {});
  return { asset, fields };
}

/**
 * Bring-in (E3): scrape a site for images and upload them into the customer folder so the
 * normal discover -> enrich -> publish flow can then act on them. In --dry-run this scrapes
 * and downloads (to prove the pipeline) but does NOT upload. Returns the uploaded assets.
 */
async function bringInFromSite({
  uploadStrategy, options, folderPath, log, report, fetchFn,
}) {
  log.info?.(`[agent] bring-in: scraping ${options.sourceUrl} for images`);
  const { images, candidates } = await scrapeSiteImages({
    pageUrl: options.sourceUrl,
    maxImages: options.limit && Number.isFinite(options.limit) ? options.limit : undefined,
    fetchFn,
    log,
  });
  if (images.length === 0) {
    log.warn?.(`[agent] bring-in: no downloadable images found at ${options.sourceUrl} (from ${candidates} candidates)`);
    return { uploaded: [] };
  }

  if (options.dryRun) {
    log.info?.(`[agent] DRY RUN — would upload ${images.length} image(s) into ${folderPath}:`);
    images.forEach((img) => log.info?.(`[agent]   ${folderPath}/${img.fileName}  <- ${img.sourceUrl}`));
    return { uploaded: [], dryRun: true, images };
  }

  const ensured = await uploadStrategy.ensureFolder({ folderPath });
  if (ensured.created) log.info?.(`[agent] bring-in: created folder ${folderPath}`);

  const { uploaded, failures } = await uploadStrategy.uploadImages({ folderPath, images });
  log.info?.(`[agent] bring-in: uploaded ${uploaded.length}/${images.length} image(s) into ${folderPath}`);
  failures.forEach((f) => {
    log.warn?.(`[agent] bring-in upload failed: ${f.fileName} — ${f.error}`);
    report.record(`${folderPath}/${f.fileName}`, OUTCOME.FAILED, { stage: 'upload', error: f.error });
  });
  return { uploaded };
}

/**
 * Run the classic enrichment flow.
 * @param {object} opts
 * @param {object} opts.options         — parsed CLI options
 * @param {import('./classic-client.js').ClassicAuthorClient} opts.client
 * @param {Function} opts.generator     — metadata generator
 * @param {object}  [opts.log]          — console-like logger
 * @param {Function} [opts.fetchFn]     — injectable fetch
 * @param {string}  [opts.uploadStrategyName]  — 'repository'|'classic'|'openapi'|null (auto)
 * @param {string}  [opts.apiKey]       — x-api-key for repository strategy
 * @returns {Promise<{ report: Report, dryRun: boolean, preview?: string }>}
 */
export async function enrichAssetsClassic({
  options, client, generator, log = console, fetchFn = fetch,
  uploadStrategyName = null, apiKey = null,
}) {
  const report = new Report();
  const { customerKey } = options;
  const scope = { company: customerKey, status: STATUS_APPROVED };
  const folderPath = options.damPath || `/content/dam/${customerKey}`;

  // Select upload strategy: repository (preferred when apiKey present), classic (fallback).
  const uploadStrategy = createUploadStrategy(uploadStrategyName, { client, apiKey, fetchFn });
  const strategyName = uploadStrategy.constructor.name;
  log.info?.(`[agent] enrich customer=${customerKey} folder=${folderPath} dryRun=${options.dryRun} uploadStrategy=${strategyName}`);

  // [0] Bring-in (E3): scrape a site and upload images before discovery.
  let broughtIn = null;
  if (options.bringIn) {
    if (!options.sourceUrl) {
      log.warn?.('[agent] --bring-in was requested without --source-url; nothing to scrape.');
    } else {
      broughtIn = await bringInFromSite({
        uploadStrategy, options, folderPath, log, report, fetchFn,
      });
      // Dry-run bring-in stops here: the images were downloaded but not uploaded, so there
      // is nothing in AEM to enumerate/enrich yet.
      if (options.dryRun) {
        return { report, dryRun: true, broughtIn };
      }
    }
  }

  // [1..3] Discover
  const { assets, matched, exceededWindow } = await enumerateFolderClassic({ client, folderPath });
  log.info?.(`[agent] found ${matched} asset(s) under ${folderPath}`);
  if (exceededWindow) {
    log.warn?.(`[agent] hit the scan cap before listing every asset under ${folderPath} — some may be missed; narrow with --dam-path`);
  }
  if (assets.length === 0) {
    log.warn?.(`[agent] No assets found under ${folderPath} — nothing to enrich. Populate the folder (or run bring-in) and retry.`);
    return { report, dryRun: options.dryRun, broughtIn };
  }

  let targetAssets = assets;
  if (options.limit && Number.isFinite(options.limit)) {
    targetAssets = assets.slice(0, options.limit);
  }

  // [4] Read + generate + normalize (bounded concurrency)
  const planned = await mapWithConcurrency(
    targetAssets,
    options.concurrency,
    async (asset) => {
      try {
        return await planAssetClassic({
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

  const preview = enrichable
    .map((p) => `${p.asset.repoPath}\n${JSON.stringify(fieldsToProperties(p.fields, scope), null, 2)}`)
    .join('\n\n');

  // [5] Dry-run stops before any write.
  if (options.dryRun) {
    log.info?.(`[agent] DRY RUN — would enrich ${enrichable.length} asset(s):`);
    if (preview) log.info?.(preview);
    enrichable.forEach((p) => report.record(p.asset.assetId, OUTCOME.ENRICHED, { dryRun: true }));
    return { report, dryRun: true, preview };
  }

  // [5] Write (per-asset Sling POST)
  await mapWithConcurrency(enrichable, options.concurrency, async (p) => {
    try {
      const properties = fieldsToProperties(p.fields, scope);
      const res = await writeAssetMetadataClassic({
        client, repoPath: p.asset.repoPath, properties,
      });
      if (res.ok) report.record(p.asset.assetId, OUTCOME.ENRICHED, { via: 'sling-post' });
      else report.record(p.asset.assetId, OUTCOME.FAILED, { stage: 'write', status: res.status });
    } catch (err) {
      report.record(p.asset.assetId, OUTCOME.FAILED, {
        stage: 'write', status: err.status, error: String(err.message || err),
      });
    }
  });

  // [6] Publish (replication activate) the assets that were written.
  if (!options.noPublish) {
    const enrichedIds = report.assets
      .filter((a) => a.outcome === OUTCOME.ENRICHED)
      .map((a) => a.assetId);
    if (enrichedIds.length > 0) {
      const { published, failures } = await publishAssetsClassic({
        client, repoPaths: enrichedIds,
      });
      log.info?.(`[agent] published ${published}/${enrichedIds.length} asset(s) via replication`);
      failures.forEach((f) => log.warn?.(`[agent] publish failed: ${f.repoPath} — ${f.error}`));
    }
  }

  return {
    report, dryRun: false, preview, broughtIn,
  };
}
