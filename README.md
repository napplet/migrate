# Napplet Migrate

A small, browser-only migration wizard for the [proposed standalone NIP-5D manifest](https://github.com/dskvr/nips/pull/7). Built with Svelte 5, Tailwind CSS, TypeScript, and Vite. No backend, account database, or private-key entry.

## Run

Use Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Connect a NIP-07 extension, scan a NostrConnect QR code, or paste a bunker URI. The connection relay defaults to `wss://bucket.coracle.social` and can be changed before connecting. The visible relay setting overrides the relay in a bunker URI; your signer must listen there. Signer approval links are shown when requested. Connection keys are ephemeral and discarded on logout or refresh.

Load your napplets or enter any napplet `naddr`. After login, the app looks up your latest signed NIP-65 (`kind:10002`) relay list using bootstrap relays. Your write relays and unmarked read/write relays are used for both napplet discovery and publishing; read-only relays are excluded. If no list is available, editable fallback relays are shown. An explicitly empty or read-only list requires adding a write relay. For another author’s naddr, discovery also checks that author’s NIP-65 write relays and the address’s relay hints. The migrated copy is signed by your connected account and published to your relays, leaving the source event intact. These relays remain configurable separately from the signer connection relay. Select events, prepare each one, review the changes, then migrate. A missing description must be filled in; `theme` starts as optional. The five-stage progress indicator stays fixed regardless of batch size.

## Schema target

Pinned to PR #7 revision [`4d0fb2e`](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md), inspected October 4, 2026. **This proposal is not merged.** Review schema changes before using a later revision.

| Old manifest                   | Proposed manifest                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `description` tag              | Required nonempty plain-text event `content`                                                         |
| `path /index.html <hash>`      | Exactly one `x <artifact-hash>` tag                                                                  |
| `x <aggregate-hash> aggregate` | Removed; never reused as the artifact hash                                                           |
| `requires <domain>`            | User chooses `R <domain>` or `O <domain>`                                                            |
| Optional/legacy metadata       | Valid `icon`, `z`, `i`, `source`, title, servers and snapshot lineage retained; obsolete `C` removed |

Descriptions are rendered literally, never as HTML or Markdown. The spec does not forbid punctuation that resembles formatting; validation rejects empty text and non-text control characters without inventing a length limit.

Kinds remain `5129`, `15129`, and `35129`. Replaceable manifests keep their kind and identifier and get a newer timestamp. Migrating your own event preserves its address; copying another author’s event changes the address to your account and can replace an existing manifest with the same identifier (or your root manifest for kind 15129); snapshots produce new events, leaving originals intact. Unknown extension tags are retained. Malformed structural metadata, ambiguous identifiers, and multi-file manifests block automatic migration rather than silently losing data. Rebundle multi-file artifacts before migrating. Unsupported or malformed optional icons are removed with a review note; generic artwork is used throughout this tool.

The artifact itself is not fetched, changed, executed, or uploaded. Its hash is copied from the original signed `/index.html` path. Download original events from the review screen and signed results after migration. Signatures, authorship, and exact signer output are verified before publication. At least one positive relay acknowledgement is required for success; partial relay failures are listed. Retrying a failed publication reuses the exact signed event. Discovery reflects the configured relays' results; relays can limit or omit history. Immutable legacy snapshots may remain discoverable after migration.

## Check

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Logic tests cover schema conversion, unsafe inputs, metadata preservation, author/signature checks, cancellation, retries, and deployment scripts. Browser tests cover desktop/mobile navigation, batch preparation, selection, owned and cross-author naddr migration, QR configuration, and real encrypted NIP-46 exchanges with an in-process test signer/relay. No production keys or relays are used by tests.

## Deploy to Bunny

1. Create a Bunny **Storage Zone**, then a **Pull Zone** connected to it. Use a dedicated storage zone for this app. Set the pull zone's default root object to `index.html`, enable HTTPS, and attach your desired hostname. The app uses no nested routes.
2. Authenticate GitHub CLI with `gh auth login`, with repository administration and secret-management access.
3. Run `npm run setup:github`. It detects the current GitHub repository, creates/updates the `production` environment, and explains and prompts for one setting at a time. Secret input is hidden and sent to `gh` over stdin. Press Enter to retain an existing setting; re-running is safe. Optionally set `GITHUB_REPOSITORY=owner/repo` or `GITHUB_ENVIRONMENT=production`.
4. Push to `main` or manually run **Deploy** from that branch. PRs run **CI**. Deployment verifies types, logic, a production build, and desktop/mobile browser tests before uploading the tested build.

| GitHub environment setting | Type     | Find it                                              |
| -------------------------- | -------- | ---------------------------------------------------- |
| `BUNNY_STORAGE_ZONE`       | Variable | Storage zone name                                    |
| `BUNNY_STORAGE_HOST`       | Variable | Storage → FTP & API access → primary region hostname |
| `BUNNY_STORAGE_PASSWORD`   | Secret   | Storage → FTP & API access → writable Password       |
| `BUNNY_PULL_ZONE_ID`       | Variable | Numeric ID in your pull zone dashboard URL           |
| `BUNNY_API_KEY`            | Secret   | Account settings → API key; used for cache purging   |

The workflow uses the `production` environment; if you use another name in setup, update the workflow accordingly. Assets upload before `index.html`, and old hashed assets are retained for cached pages/open tabs. Cache is purged only after every upload succeeds. Uploads and purge failures stop the workflow. Deployment credentials never enter the Vite build. The setup script configures existing Bunny resources; it does not create them.

Bunny API contract references: [storage OpenAPI](https://github.com/BunnyWay/documentation/blob/main/api-reference/storage/openapi.json), [core OpenAPI](https://github.com/BunnyWay/documentation/blob/main/api-reference/core/openapi.json).

## Layout

- `src/lib/migration.ts`: pure schema analysis, defaults, validation, transformation, deduplication.
- `src/lib/nostr.ts`: NIP-07/NIP-46 sessions, relay discovery/publication, signature boundaries.
- `src/lib/batch.ts`: sequential signing/publication, cancellation, and retry state.
- `src/components/Auth.svelte`, `src/App.svelte`, `src/style.css`: presentation and wizard navigation.
- `scripts/`: guided GitHub configuration and Bunny deployment, both with tests.
- `.github/workflows/`: PR checks and gated production deployment.
