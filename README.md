<div align="center">

# Napplet Migrate

Prepare, review, and publish napplet manifests for the proposed NIP-5D schema.

[![CI](https://img.shields.io/github/actions/workflow/status/napplet/migrate/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/napplet/migrate/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-5F7955?style=for-the-badge)](https://nodejs.org/)

</div>

Napplet Migrate updates the metadata that describes a napplet to the [proposed NIP-5D format](https://github.com/dskvr/nips/pull/7). It runs in your browser and lets you review changes before publishing them to Nostr.

You can migrate your own napplets or copy someone else’s to your account. The napplet’s files stay untouched.

<p align="center">
  <img src="docs/images/prepare.png" width="800" alt="Preparation screen showing a copyable napplet address, description, required and optional APIs, and raw event JSON disclosure." />
</p>

## Run locally

You need **Node.js 24 or newer**.

```sh
git clone https://github.com/napplet/migrate.git
cd migrate
npm ci
npm run dev
```

Open the URL printed by Vite. No environment variables or backend setup are needed.

To migrate, connect a Nostr browser extension (NIP-07) or a remote signer (NIP-46). The app never asks you to enter your private key.

## How it works

1. **Connect** — use an extension, scan a NostrConnect QR code, or paste a bunker URI.
2. **Choose** — load your napplets or paste any napplet `naddr`. Select one or several.
3. **Prepare** — fill in the description and choose which APIs are required or optional.
4. **Review** — compare the original and updated JSON, and download a backup.
5. **Migrate** — approve signing, publish to your relays, and download the results.

Your publishing relays come from your **NIP-65 relay list** and can be edited in the app. Another author’s napplet is copied under your account, leaving their original intact.

## What changes?

| Before                               | After                     |
| ------------------------------------ | ------------------------- |
| Description stored in a tag          | Plain-text event content  |
| Legacy file paths and aggregate hash | A single artifact hash    |
| Undifferentiated API requirements    | Required or optional APIs |

Source references can use **HTTP(S), Blossom, `git://`, or Nostr Git URLs**. Files are never downloaded, modified, or uploaded by the migration tool.

- **Inspect:** open raw event JSON; validation errors show the exact problematic entry.
- **Copy:** click an address bubble to copy the full address.
- **Review replacements:** publishing can replace a manifest with the same identifier under your account.
- **Single-file only:** multi-file napplets must be rebundled before migration.

The app targets a pinned proposal revision. See [migration details](docs/migration.md) for compatibility rules and signer settings.

## More

- [Migration details](docs/migration.md)
- [Checks and verification](docs/verification.md)
- [Deployment guide](docs/deployment.md)
- [Report an issue](https://github.com/napplet/migrate/issues)
