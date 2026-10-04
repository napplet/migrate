# Acceptance verification

Verified locally on October 4, 2026 against PR #7 revision `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`.

| Requirement                                   | Implementation and evidence                                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NIP-07 authentication                         | `extensionLogin`; browser extension fixture completes discovery, signing, publication, and logout. Missing-extension error tested.                                                                                                                  |
| NIP-46 QR + bunker URI                        | `remoteLogin`; browser tests exercise both with real NIP-44 encryption, a distinct bunker/author key, and post-login signing approval links.                                                                                                        |
| Configurable connection relay, bucket default | Authentication relay input; QR test verifies default and custom relay encoded in URI; bunker tests connect with an overridden relay.                                                                                                                |
| NIP-65 relay discovery                        | Latest verified author kind 10002 supplies write/unmarked relays. Tests cover signatures, authors, recency, tie-breaking, URL validation, fallback, read-only lists and actual discovery/publication destinations.                                  |
| My napplets and a specific naddr              | Repository queries all three kinds; owned and cross-author naddr migration covered by desktop/mobile tests. Copies are discovered on source-author NIP-65 relays and published with the connected account’s key and relays.                         |
| Select and begin migration                    | Select/deselect and disabled empty selection tested; batch flow starts via Begin Migration.                                                                                                                                                         |
| Required/optional APIs, theme default         | Pure conversion tests and browser interaction verify defaults, overrides, and resulting `R` / `O` tags.                                                                                                                                             |
| Missing description, plain text               | Missing-description browser step blocks continuation; unit tests cover empty/control-character validation and literal text semantics.                                                                                                               |
| Review and migrate                            | Before/after JSON, field summaries, original backup, explicit signing action, receipt list and signed-event export implemented. Browser tests reach confirmed publication.                                                                          |
| Other schema discrepancies                    | Tests cover aggregate-to-artifact hash, `description` removal, path removal, cardinality, icons, lineage, intent shape, HTTP(S)/Blossom/git:// and NIP-34 nostr:// source references, server URLs, metadata preservation, and multi-file rejection. |
| Minimal responsive UI and progress            | Five stable stages, authentication-only initial panel, logout after authentication, one-at-a-time batch editor, separate publication progress. Desktop/mobile screenshots inspected; overflow and uncaught-page-error checks pass.                  |
| Svelte / Tailwind / Vite and separated logic  | Svelte views; Tailwind import/theme; Vite production build. Schema, Nostr transport/authentication, and batch orchestration live in separate modules under `src/lib`.                                                                               |
| PR tests                                      | `ci.yml` checks types, unit/script tests, production build, and browser tests on pull requests.                                                                                                                                                     |
| Bunny deployment workflow                     | `deploy.yml` verifies the same gates, transfers the build artifact, then runs deployment in the production environment. Tests verify assets-before-HTML, correct credential routing, purge ordering, and failure behavior.                          |
| Guided idempotent GitHub configuration        | Setup prompts sequentially with descriptions/locations, hides secrets, passes secrets via stdin, retains existing values, and creates an environment only if missing. Script tests cover these operations through a mocked CLI boundary.            |

Final local gates:

- `npm run check`: zero errors and warnings.
- `npm test`: 39 tests pass.
- `npm run build`: production bundle builds.
- `npm run test:e2e`: 28 tests pass across desktop Chromium and mobile emulation, served from the production build using Vite preview.

Scope of verification: transport and signer tests use controlled relays and keys. Deployment HTTP requests and GitHub CLI writes are mocked in script tests. Local verification does not establish a successful live Bunny deployment or GitHub-hosted workflow run; deployment requires the user's configured Bunny resources and GitHub environment. Setup instructions and required configuration are in the [deployment guide](deployment.md).

The reported Supersonic RC Revive event (`556f7c44…`) is retained as a signed regression fixture. Tests verify that its Nostr Git source, Blossom archive and commit reference survive migration, and that preparation exposes raw JSON and indexed validation context.

Address-chip browser checks exercise actual clipboard writes on desktop/mobile, keyboard activation, selection remaining unchanged after copying, the source versus migrated author address, and manual copying when clipboard access is denied.

## Run the checks

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Use `npm run preview` to serve a production build locally. Browser tests also run against the production build and cover desktop and mobile layouts, batch migration, cross-author copies, clipboard behavior, validation context, and encrypted NIP-46 exchanges with a test signer and relay.

Unit tests cover schema conversion, metadata preservation, signature checks, cancellation, retries, and deployment scripts. Tests use controlled keys and relays. Recorded results and scope are listed above.
