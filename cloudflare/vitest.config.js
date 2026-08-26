import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          kvNamespaces: ['AUTH_TOKENS', 'SAVED_SEARCHES', 'MESSAGES'],
        },
      },
    },
  },
});
