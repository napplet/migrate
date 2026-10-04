# Deployment

[← README](../README.md)

## Bunny setup

1. Create a Bunny **Storage Zone** dedicated to this app and a **Pull Zone** connected to it. Set the default root object to `index.html`, enable HTTPS, and attach your hostname. The app uses no nested routes.
2. Authenticate the GitHub CLI with `gh auth login`, using an account with repository administration and secret-management access.
3. Run `npm run setup:github` in an interactive terminal. It detects the repository, creates the `production` environment if missing, and prompts for each setting below. Secret input is hidden; press Enter to retain an existing value. Re-running is safe.
4. Push to `main` or manually run [Deploy](https://github.com/napplet/migrate/actions/workflows/deploy.yml) from that branch. The workflow checks types, unit tests, the production build, and browser tests before uploading that build.

| GitHub environment setting | Type     | Value                                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `BUNNY_STORAGE_ZONE`       | Variable | Storage zone name                                                                           |
| `BUNNY_STORAGE_HOST`       | Variable | Primary region hostname from Storage → FTP & API access; defaults to `storage.bunnycdn.com` |
| `BUNNY_STORAGE_PASSWORD`   | Secret   | Writable storage password from Storage → FTP & API access                                   |
| `BUNNY_PULL_ZONE_ID`       | Variable | Numeric ID from the pull zone dashboard URL                                                 |
| `BUNNY_API_KEY`            | Secret   | Account API key, used for cache purging                                                     |

Setup accepts `GITHUB_REPOSITORY=owner/repo` and `GITHUB_ENVIRONMENT=production` overrides. If you choose another environment name, update the deployment workflow to match. The setup script configures GitHub for existing Bunny resources; it does not create those resources.

Assets upload before `index.html`, and old hashed assets remain available for cached pages and open tabs. Cache purging starts only after every upload succeeds; upload or purge failures fail the workflow. Deployment credentials never enter the Vite build.

## References

- [Deployment workflow](../.github/workflows/deploy.yml)
- [GitHub setup script](../scripts/setup-github.mjs)
- [Upload script](../scripts/deploy-bunny.mjs)
- [Bunny storage API](https://github.com/BunnyWay/documentation/blob/main/api-reference/storage/openapi.json)
- [Bunny core API](https://github.com/BunnyWay/documentation/blob/main/api-reference/core/openapi.json)
