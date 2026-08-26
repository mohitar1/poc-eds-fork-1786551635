import { describe, it, expect } from 'vitest';
import { submitMetadataImport, pollMetadataImportJob } from '../write-bulk.js';
import { makeRes, makeClient } from './helpers.js';

describe('write-bulk', () => {
  describe('submitMetadataImport', () => {
    it('posts the CSV as multipart form-data with a respond-async Prefer header', async () => {
      const client = makeClient([makeRes({ status: 200, body: { ok: true } })]);
      await submitMetadataImport(client, 'a,b\n1,2\n');
      const { op, opts } = client.calls[0];
      expect(op).toBe('metadataImport');
      expect(opts.method).toBe('POST');
      expect(opts.path).toBe('/assets/metadata/import');
      expect(opts.headers.Prefer).toBe('respond-async');
      expect(opts.body).toBeInstanceOf(FormData);
      expect(opts.body.get('file')).toBeTruthy();
    });

    it('adds a wait to the Prefer header when waitSeconds > 0', async () => {
      const client = makeClient([makeRes({ status: 200, body: {} })]);
      await submitMetadataImport(client, 'csv', { waitSeconds: 30 });
      expect(client.calls[0].opts.headers.Prefer).toBe('respond-async, wait=30');
    });

    it('uses the provided file name for the multipart part', async () => {
      const client = makeClient([makeRes({ status: 200, body: {} })]);
      await submitMetadataImport(client, 'csv', { fileName: 'batch-2.csv' });
      const file = client.calls[0].opts.body.get('file');
      expect(file.name).toBe('batch-2.csv');
    });

    it('returns an async descriptor with the parsed jobId on 202', async () => {
      const accepted = makeRes({
        status: 202,
        headers: { Location: '/adobe/assets/metadata/import/jobs/imp-42/status' },
      });
      const client = makeClient([accepted]);
      const out = await submitMetadataImport(client, 'csv');
      expect(out).toMatchObject({
        sync: false,
        status: 202,
        jobId: 'imp-42',
        location: '/adobe/assets/metadata/import/jobs/imp-42/status',
      });
    });

    it('returns a sync result with the parsed body on a 2xx non-202', async () => {
      const client = makeClient([makeRes({ status: 200, body: { imported: 3 } })]);
      const out = await submitMetadataImport(client, 'csv');
      expect(out.sync).toBe(true);
      expect(out.jobId).toBeNull();
      expect(out.result).toEqual({ imported: 3 });
    });

    it('throws with the status and body text on a hard failure', async () => {
      const client = makeClient([makeRes({ status: 400, body: 'bad csv' })]);
      await expect(submitMetadataImport(client, 'csv')).rejects.toThrow(/400 bad csv/);
    });
  });

  describe('pollMetadataImportJob', () => {
    it('keeps polling while the job is non-terminal, then returns the final status', async () => {
      const client = makeClient([
        makeRes({ body: { status: 'PROCESSING' } }),
        makeRes({ body: { status: 'RUNNING' } }),
        makeRes({ body: { status: 'COMPLETED', imported: 5 } }),
      ]);
      const out = await pollMetadataImportJob(client, 'imp-1', { sleepFn: async () => {} });
      expect(out).toEqual({ status: 'COMPLETED', imported: 5 });
      expect(client.calls).toHaveLength(3);
      expect(client.calls[0].opts.path).toContain('/jobs/imp-1/status');
    });

    it('treats a FAILED terminal state as complete and returns it', async () => {
      const client = makeClient([makeRes({ body: { status: 'FAILED' } })]);
      const out = await pollMetadataImportJob(client, 'imp-1', { sleepFn: async () => {} });
      expect(out.status).toBe('FAILED');
      expect(client.calls).toHaveLength(1);
    });

    it('throws when the job never reaches a terminal state within maxPolls', async () => {
      const client = makeClient([
        makeRes({ body: { status: 'PROCESSING' } }),
        makeRes({ body: { status: 'PROCESSING' } }),
      ]);
      await expect(
        pollMetadataImportJob(client, 'imp-1', { maxPolls: 2, sleepFn: async () => {} }),
      ).rejects.toThrow(/did not complete within 2 polls/);
    });
  });
});
