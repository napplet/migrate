import { naddrEncode, neventEncode } from 'nostr-tools/nip19'
import type { NostrEvent } from 'nostr-tools'

export function nappletAddress(event: NostrEvent): string | null {
  if (event.kind === 5129)
    return neventEncode({ id: event.id, author: event.pubkey })
  if (event.kind !== 15129 && event.kind !== 35129) return null
  const identifiers = event.tags.filter((tag) => tag[0] === 'd')
  if (
    event.kind === 35129 &&
    (identifiers.length !== 1 || identifiers[0].length !== 2)
  )
    return null
  return naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: event.kind === 35129 ? identifiers[0][1] : '',
  })
}
