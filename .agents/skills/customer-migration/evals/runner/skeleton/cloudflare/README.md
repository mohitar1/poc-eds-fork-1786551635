# cloudflare

The Cloudflare Worker backend for the portal. Local secrets for `wrangler dev`
live in a gitignored `cloudflare/.secrets` file (copy `.secrets.template`). The
customer adds `SPARK_DM_CLIENT_ID`, `SPARK_DM_CLIENT_SECRET`, and
`SPARK_COOKIE_SECRET` there themselves. The file must exist or `wrangler dev`'s
`predev` hook fails to boot.
