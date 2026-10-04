# Migration details

[← README](../README.md)

## Signers and relays

The remote signer connection relay defaults to `wss://bucket.coracle.social` and can be changed before connecting. This setting overrides the relay in a bunker URI, so the signer must listen there. Approval links appear when requested; connection keys are ephemeral and discarded on logout or refresh.

Discovery and publication use a separate, editable relay list derived from your latest verified **NIP-65 (`kind:10002`) event**:

- Write relays and unmarked read/write relays are included; read-only relays are excluded.
- If no list is available, the app offers fallback relays. An explicitly empty or read-only list requires adding a write relay.
- Looking up another author’s `naddr` also checks their NIP-65 write relays and the address’s relay hints.

Copies of another author’s napplet are signed by **your connected account** and published to **your relays**. The source event remains intact. A copy can replace an existing manifest under your account with the same kind and identifier, or your root manifest for kind `15129`; inspect the review before publishing.

## Schema and compatibility

The migration targets [PR #7](https://github.com/dskvr/nips/pull/7) at pinned revision [`4d0fb2e`](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md). This is a proposal, and the app does not automatically follow later revisions.

| Legacy manifest                | Migrated manifest                                              |
| ------------------------------ | -------------------------------------------------------------- |
| `description` tag              | Required nonempty plain-text event `content`                   |
| `path /index.html <hash>`      | Exactly one `x <artifact-hash>` tag                            |
| `x <aggregate-hash> aggregate` | Removed; never reused as the artifact hash                     |
| `requires <domain>`            | Your choice of `R <domain>` or `O <domain>`                    |
| Metadata and extension tags    | Valid metadata and unknown tags retained; obsolete `C` removed |

**Source references:** HTTP(S), `git://`, [NIP-34 `nostr://` Git repository URLs](https://github.com/nostr-protocol/nips/blob/master/34.md), and Blossom references, including [BUD-10 URIs](https://github.com/hzrd149/blossom/blob/master/buds/10.md) with discovery hints. Legacy hash-only and `blossom://` forms are also supported. This extends the pinned draft’s HTTP(S)-only source wording. References are preserved exactly without fetching their contents.

**Descriptions:** displayed literally, with no HTML or Markdown rendering. Validation rejects empty text and non-text control characters; punctuation that resembles formatting is allowed, with no imposed length limit.

**Event identity:** kinds remain `5129`, `15129`, and `35129`. Replaceable manifests retain their kind and identifier and receive a newer timestamp. Migrating your own replaceable event preserves its address; copying another author’s event changes the address to your account. Snapshots produce new events.

**Automatic migration limits:** ambiguous identifiers, malformed structural metadata, and multi-file manifests block migration. Rebundle multi-file artifacts first. Invalid optional icons are removed with a review note. The artifact itself is never fetched, changed, executed, or uploaded; its hash comes from the original signed `/index.html` path.

Signatures, authorship, and exact signer output are verified before publication. Success requires at least one positive relay acknowledgement; partial failures are listed. Retrying a failed publication reuses the signed event. Discovery depends on the configured relays’ available history, and immutable legacy snapshots may remain discoverable after migration.
