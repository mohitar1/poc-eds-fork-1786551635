import { describe, it, expect } from 'vitest';
import {
  mkdtempSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  slugify, parseEnvFile, parseArgs, validateOptions, resolveCreds, resolveImsToken,
} from '../config.js';

describe('config', () => {
  describe('slugify', () => {
    it('slugifies brand names', () => {
      expect(slugify('Santander AG')).toBe('santander-ag');
      expect(slugify('  ACME, Inc.  ')).toBe('acme-inc');
    });
  });

  describe('parseEnvFile', () => {
    it('parses key=value, ignores comments, strips quotes', () => {
      const parsed = parseEnvFile('# comment\nA=1\nB="two"\nC=\'three\'\n\nBAD');
      expect(parsed).toEqual({ A: '1', B: 'two', C: 'three' });
    });
  });

  describe('parseArgs', () => {
    it('derives damPath from customerKey and parses flags', () => {
      const opts = parseArgs(['--customer-key', 'Santander', '--dry-run', '--write-mode', 'patch']);
      expect(opts.customerKey).toBe('santander');
      expect(opts.damPath).toBe('/content/dam/santander');
      expect(opts.dryRun).toBe(true);
      expect(opts.writeMode).toBe('patch');
    });

    it('turns on bring-in when a source URL is given', () => {
      const opts = parseArgs(['--customer-key', 'x', '--source-url', 'https://x.com']);
      expect(opts.bringIn).toBe(true);
      expect(opts.sourceUrl).toBe('https://x.com');
    });
  });

  describe('validateOptions', () => {
    it('requires a customer key', () => {
      expect(validateOptions(parseArgs([]))).toContain('--customer-key is required');
    });
    it('rejects an unknown write mode', () => {
      const errs = validateOptions(parseArgs(['--customer-key', 'x', '--write-mode', 'nope']));
      expect(errs.some((e) => e.includes('write-mode'))).toBe(true);
    });
    it('passes for a valid set', () => {
      expect(validateOptions(parseArgs(['--customer-key', 'x']))).toEqual([]);
    });
  });

  describe('resolveCreds', () => {
    it('prefers explicit env creds', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-envcreds-'));
      try {
        const out = resolveCreds({
          env: { SPARK_DM_CLIENT_ID: 'id', SPARK_DM_CLIENT_SECRET: 'sec' },
          secretsFile: join(dir, 'missing'),
          repoRoot: dir,
        });
        expect(out).toMatchObject({ clientId: 'id', clientSecret: 'sec', source: 'env' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reads SPARK_DM_* from a secrets file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-creds-'));
      const file = join(dir, '.secrets');
      writeFileSync(file, 'SPARK_DM_CLIENT_ID=abc\nSPARK_DM_CLIENT_SECRET=xyz\n');
      try {
        const out = resolveCreds({ secretsFile: file, env: {} });
        expect(out).toMatchObject({ clientId: 'abc', clientSecret: 'xyz' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('throws with guidance when nothing is found', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-nocreds-'));
      try {
        expect(() => resolveCreds({
          secretsFile: join(dir, 'missing'), repoRoot: dir, env: {},
        })).toThrow(/No DM credentials/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveImsToken', () => {
    it('prefers the env token + api key and strips a Bearer prefix', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-envtok-'));
      try {
        const out = resolveImsToken({
          env: { AUTHOR_SPARK_IMS_TOKEN: 'Bearer  eyJ.abc', AUTHOR_SPARK_IMS_API_KEY: 'key123' },
          secretsFile: join(dir, 'missing'),
          repoRoot: dir,
        });
        expect(out).toEqual({ token: 'eyJ.abc', apiKey: 'key123', source: 'env' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns apiKey null when the token is set but no api key is', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-envtok2-'));
      try {
        const out = resolveImsToken({
          env: { AUTHOR_SPARK_IMS_TOKEN: 'eyJ.abc' },
          secretsFile: join(dir, 'missing'),
          repoRoot: dir,
        });
        expect(out).toEqual({ token: 'eyJ.abc', apiKey: null, source: 'env' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reads token + api key from a secrets file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-tok-'));
      const file = join(dir, '.secrets');
      writeFileSync(file, 'AUTHOR_SPARK_IMS_TOKEN=eyJ.file\nAUTHOR_SPARK_IMS_API_KEY=filekey\n');
      try {
        const out = resolveImsToken({ secretsFile: file, env: {}, repoRoot: dir });
        expect(out).toMatchObject({ token: 'eyJ.file', apiKey: 'filekey', source: file });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns null when no token is present', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-notok-'));
      try {
        expect(resolveImsToken({
          secretsFile: join(dir, 'missing'), repoRoot: dir, env: {},
        })).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
