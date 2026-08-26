import { describe, it, expect } from 'vitest';
import {
  initiateUpload, putUploadParts, completeUpload, uploadAssets,
  importFromUrl, pollImportJob,
} from '../bring-in.js';
import { UPLOAD_ASSETS_MAX, IMPORT_FILES_MAX } from '../constants.js';
import { makeRes, makeClient } from './helpers.js';

describe('bring-in', () => {
  describe('initiateUpload', () => {
    it('posts the asset descriptors and returns the data.assets list', async () => {
      const client = makeClient([
        makeRes({ body: { data: { assets: [{ assetId: 'a1', uploadURIs: ['u'] }] } } }),
      ]);
      const out = await initiateUpload(client, [
        { fileName: 'x.jpg', path: '/content/dam/acme/x.jpg', fileSize: 10 },
      ]);
      const { op, opts } = client.calls[0];
      expect(op).toBe('upload');
      expect(opts.path).toBe('/assets');
      expect(JSON.parse(opts.body)).toEqual({
        assets: [{ fileName: 'x.jpg', path: '/content/dam/acme/x.jpg', fileSize: 10 }],
      });
      expect(out).toHaveLength(1);
      expect(out[0].assetId).toBe('a1');
    });

    it('falls back to a top-level assets list when data is absent', async () => {
      const client = makeClient([makeRes({ body: { assets: [{ assetId: 'b1' }] } })]);
      const out = await initiateUpload(client, [{ fileName: 'y', path: '/p', fileSize: 1 }]);
      expect(out[0].assetId).toBe('b1');
    });

    it('throws when more than the max assets are requested', async () => {
      const client = makeClient([]);
      const tooMany = Array.from({ length: UPLOAD_ASSETS_MAX + 1 }, (_, i) => ({
        fileName: `f${i}`, path: `/p/${i}`, fileSize: 1,
      }));
      await expect(initiateUpload(client, tooMany)).rejects.toThrow(/max 1000 assets/);
    });
  });

  describe('putUploadParts', () => {
    it('splits the bytes across every upload URI in order', async () => {
      const puts = [];
      const putFn = async (uri, init) => {
        puts.push({ uri, size: init.body.byteLength });
        return { ok: true };
      };
      const bytes = new Uint8Array(100);
      await putUploadParts(
        { uploadURIs: ['u0', 'u1'], minPartSize: 0 },
        bytes,
        { putFn },
      );
      expect(puts.map((p) => p.uri)).toEqual(['u0', 'u1']);
      expect(puts.reduce((n, p) => n + p.size, 0)).toBe(100);
    });

    it('throws when the descriptor has no upload URIs', async () => {
      const putFn = async () => ({ ok: true });
      await expect(
        putUploadParts({ uploadURIs: [] }, new Uint8Array(4), { putFn }),
      ).rejects.toThrow(/no uploadURIs/);
    });

    it('throws when a part PUT fails', async () => {
      const putFn = async () => ({ ok: false, status: 503 });
      await expect(
        putUploadParts({ uploadURIs: ['u0'], minPartSize: 0 }, new Uint8Array(8), { putFn }),
      ).rejects.toThrow(/upload part 0 -> 503/);
    });
  });

  describe('completeUpload', () => {
    it('posts the upload token, file name and path to the completeUpload path', async () => {
      const client = makeClient([makeRes({ body: { ok: true } })]);
      await completeUpload(client, 'a1', { uploadToken: 'tok', fileName: 'x.jpg', path: '/p/x.jpg' });
      const { opts } = client.calls[0];
      expect(opts.path).toBe('/assets/a1/completeUpload');
      expect(JSON.parse(opts.body)).toEqual({ uploadToken: 'tok', fileName: 'x.jpg', path: '/p/x.jpg' });
    });
  });

  describe('uploadAssets', () => {
    it('initiates, PUTs bytes and completes each asset, returning created ids', async () => {
      const client = makeClient([
        makeRes({
          body: {
            data: {
              assets: [
                {
                  assetId: 'a1', uploadToken: 't1', path: '/p/a.jpg', uploadURIs: ['u'], minPartSize: 0,
                },
              ],
            },
          },
        }),
        makeRes({ body: { ok: true } }), // completeUpload
      ]);
      const putFn = async () => ({ ok: true });
      const out = await uploadAssets(
        client,
        [{
          fileName: 'a.jpg', path: '/p/a.jpg', fileSize: 4, bytes: new Uint8Array(4),
        }],
        { putFn },
      );
      expect(out).toEqual([{ assetId: 'a1', path: '/p/a.jpg', fileName: 'a.jpg' }]);
      expect(client.calls.map((c) => c.opts.path)).toEqual(['/assets', '/assets/a1/completeUpload']);
    });
  });

  describe('importFromUrl', () => {
    it('returns an async descriptor with the parsed jobId on 202', async () => {
      const client = makeClient([
        makeRes({ status: 202, headers: { Location: '/adobe/assets/import/jobs/imp-9/status' } }),
      ]);
      const out = await importFromUrl(client, {
        folder: '/content/dam/acme', files: [{ url: 'https://x/y.jpg', fileName: 'y.jpg' }],
      });
      expect(out).toEqual({
        async: true, jobId: 'imp-9', location: '/adobe/assets/import/jobs/imp-9/status',
      });
      expect(client.calls[0].opts.path).toBe('/assets/import/fromUrl');
    });

    it('includes assetMetadata in the body when provided', async () => {
      const client = makeClient([makeRes({ status: 200, body: {} })]);
      await importFromUrl(client, {
        folder: '/f', files: [{ url: 'u' }], assetMetadata: { 'dc:title': 'T' },
      });
      expect(JSON.parse(client.calls[0].opts.body).assetMetadata).toEqual({ 'dc:title': 'T' });
    });

    it('returns a sync result on a 2xx non-202', async () => {
      const client = makeClient([makeRes({ status: 200, body: { imported: 1 } })]);
      const out = await importFromUrl(client, { folder: '/f', files: [{ url: 'u' }] });
      expect(out).toEqual({ async: false, result: { imported: 1 } });
    });

    it('throws when more than the max files are requested', async () => {
      const client = makeClient([]);
      const files = Array.from({ length: IMPORT_FILES_MAX + 1 }, (_, i) => ({ url: `u${i}` }));
      await expect(importFromUrl(client, { folder: '/f', files })).rejects.toThrow(/max 300 files/);
    });

    it('throws with the status and body on a hard failure', async () => {
      const client = makeClient([makeRes({ status: 500, body: 'boom' })]);
      await expect(
        importFromUrl(client, { folder: '/f', files: [{ url: 'u' }] }),
      ).rejects.toThrow(/importFromUrl -> 500 boom/);
    });
  });

  describe('pollImportJob', () => {
    it('polls until terminal, then fetches and returns the result', async () => {
      const client = makeClient([
        makeRes({ body: { status: 'PROCESSING' } }),
        makeRes({ body: { status: 'COMPLETED' } }),
        makeRes({ body: { assets: ['a1'] } }), // result fetch
      ]);
      const out = await pollImportJob(client, 'imp-9', { sleepFn: async () => {} });
      expect(out.status).toEqual({ status: 'COMPLETED' });
      expect(out.result).toEqual({ assets: ['a1'] });
      expect(client.calls[0].opts.path).toContain('/jobs/imp-9/status');
      expect(client.calls[2].opts.path).toContain('/jobs/imp-9/result');
    });

    it('throws when the job never completes within maxPolls', async () => {
      const client = makeClient([
        makeRes({ body: { status: 'RUNNING' } }),
        makeRes({ body: { status: 'RUNNING' } }),
      ]);
      await expect(
        pollImportJob(client, 'imp-9', { maxPolls: 2, sleepFn: async () => {} }),
      ).rejects.toThrow(/did not complete within 2 polls/);
    });
  });
});
