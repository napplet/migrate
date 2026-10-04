import type { EventTemplate, NostrEvent } from 'nostr-tools'
export const SPEC_REVISION = '4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51'
export const KINDS = [5129, 15129, 35129]
const HASH = /^[0-9a-f]{64}$/
export type Draft = {
  original: NostrEvent
  description: string
  capabilities: { name: string; optional: boolean }[]
}
export const tags = (event: Pick<NostrEvent, 'tags'>, name: string) =>
  event.tags.filter((t) => t[0] === name)
export const title = (event: NostrEvent) =>
  tags(event, 'title')[0]?.[1] ||
  tags(event, 'd')[0]?.[1] ||
  (event.kind === 15129 ? 'Root napplet' : 'Untitled snapshot')
export const isLegacy = (event: NostrEvent) =>
  event.tags.some(
    (t) =>
      ['path', 'requires', 'description'].includes(t[0]) ||
      (t[0] === 'x' && t[2] === 'aggregate'),
  )
export function createDraft(original: NostrEvent): Draft {
  const required = [...tags(original, 'requires'), ...tags(original, 'R')].map(
    (t) => t[1] ?? '',
  )
  const optional = tags(original, 'O').map((t) => t[1] ?? '')
  return {
    original,
    description:
      tags(original, 'description')[0]?.[1] || original.content || '',
    capabilities: [...new Set([...required, ...optional])].map((name) => ({
      name,
      optional:
        name === 'theme' ||
        (!required.includes(name) && optional.includes(name)),
    })),
  }
}
export function descriptionError(value: string): string | undefined {
  if (!value.trim()) return 'Add a plain-text description before continuing.'
  // The proposal requires plain text, not a ban on punctuation or Markdown-looking text.
  // All input is kept literally and rendered through escaped text interpolation.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value))
    return 'Remove non-text control characters from the description.'
}
function httpUrl(value: string, originOnly = false): boolean {
  try {
    const u = new URL(value)
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      (!originOnly || (u.pathname === '/' && !u.search && !u.hash))
    )
  } catch {
    return false
  }
}
export function migrationIssues(draft: Draft): string[] {
  const e = draft.original,
    errors: string[] = []
  if (!KINDS.includes(e.kind))
    errors.push('This is not a napplet manifest kind.')
  const ds = tags(e, 'd')
  if (e.kind === 35129 ? ds.length !== 1 || ds[0].length !== 2 : ds.length > 0)
    errors.push('The identifier tags do not match this event kind.')
  const paths = tags(e, 'path')
  if (
    paths.length &&
    (paths.length !== 1 ||
      paths[0][1] !== '/index.html' ||
      paths[0].length !== 3 ||
      !HASH.test(paths[0][2]))
  )
    errors.push(
      'Automatic migration requires exactly one /index.html path with a valid SHA-256. Rebundle extra files into a self-contained artifact first.',
    )
  if (
    !paths.length &&
    (tags(e, 'x').length !== 1 ||
      tags(e, 'x')[0].length !== 2 ||
      !HASH.test(tags(e, 'x')[0][1]))
  )
    errors.push(
      'No unambiguous artifact hash was found. An aggregate hash cannot be reused as an artifact hash.',
    )
  for (const name of ['title', 'source', 'description', 'icon', 'a', 'A'])
    if (tags(e, name).length > 1)
      errors.push(`Multiple ${name} tags need manual resolution.`)
  for (const t of tags(e, 'source'))
    if (t.length !== 2 || !httpUrl(t[1]))
      errors.push('Source must be an absolute HTTP or HTTPS URL.')
  for (const t of tags(e, 'server'))
    if (t.length !== 2 || !httpUrl(t[1], true))
      errors.push(
        'Blossom server hints must be HTTP or HTTPS origins without paths.',
      )
  for (const t of [...tags(e, 'a'), ...tags(e, 'A')])
    if (
      e.kind !== 5129 ||
      t.length !== 2 ||
      !/^35129:[0-9a-f]{64}:.*$/.test(t[1])
    )
      errors.push(
        'Lineage is only supported on snapshots with valid named napplet addresses.',
      )
  for (const t of tags(e, 'i'))
    if (
      !t[1] ||
      /[?#\s]/.test(t[1]) ||
      t.slice(2).some((p) => !p || /[?&#=\s]/.test(p))
    )
      errors.push(
        'Intent identities must be queryless and parameter names must be non-empty.',
      )
  for (const t of tags(e, 'z'))
    if (t.length !== 2 || !t[1]?.trim())
      errors.push('Archetype tags must name an archetype.')
  for (const t of tags(e, 'title'))
    if (t.length !== 2)
      errors.push('Title tags must contain one display label.')
  if (
    draft.capabilities.some(
      (c) =>
        !c.name ||
        !/^[a-z][a-z0-9-]*$/.test(c.name) ||
        c.name.startsWith('NAP-'),
    )
  )
    errors.push(
      'Capabilities must be bare NAP domains, such as relay or theme.',
    )
  const descError = descriptionError(draft.description)
  if (descError) errors.push(descError)
  return errors
}
export function validIcon(t: string[]) {
  return (
    t.length === 3 &&
    HASH.test(t[1]) &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(t[2])
  )
}
export function migrationNotes(
  draft: Draft,
  publisher = draft.original.pubkey,
): string[] {
  const e = draft.original,
    notes = [
      'Description is stored as plain text in event content.',
      'Required APIs become R tags; optional APIs become O tags.',
    ]
  if (tags(e, 'path').length)
    notes.push(
      'The /index.html file hash replaces the aggregate x hash. The HTML artifact is unchanged.',
    )
  if (tags(e, 'icon').some((t) => !validIcon(t)))
    notes.push(
      'An invalid or unsupported icon is removed; clients will show generic artwork.',
    )
  if (tags(e, 'C').length)
    notes.push(
      'Obsolete C capability tags are removed. Review the API choices carefully.',
    )
  if (e.pubkey !== publisher) {
    notes.push(
      'Publishes a copy under your account. The original author’s event remains unchanged.',
    )
    if (e.kind === 35129)
      notes.push(
        'Keeps the same identifier. This replaces any napplet you already have at that identifier.',
      )
    if (e.kind === 15129)
      notes.push(
        'This becomes your root napplet, replacing your existing root manifest if you have one.',
      )
  } else if (e.kind === 5129)
    notes.push(
      'This creates a new snapshot. The original snapshot remains available.',
    )
  else
    notes.push('This replaces the current manifest at the same Nostr address.')
  return notes
}
export function buildMigration(
  draft: Draft,
  now = Math.floor(Date.now() / 1000),
): EventTemplate {
  const errors = migrationIssues(draft)
  if (errors.length) throw new Error(errors.join(' '))
  const e = draft.original,
    path = tags(e, 'path')[0]
  const keep = e.tags.filter(
    (t) =>
      !['path', 'x', 'requires', 'R', 'O', 'description', 'C'].includes(t[0]) &&
      (t[0] !== 'icon' || validIcon(t)),
  )
  return {
    kind: e.kind,
    created_at: Math.max(now, e.created_at + 1),
    content: draft.description.trim(),
    tags: [
      ...keep.map((t) => [...t]),
      ['x', path?.[2] ?? tags(e, 'x')[0][1]],
      ...draft.capabilities.map((c) => [c.optional ? 'O' : 'R', c.name]),
    ],
  }
}
export function latestManifests(events: NostrEvent[]): NostrEvent[] {
  const map = new Map<string, NostrEvent>()
  for (const e of events) {
    const key =
      e.kind === 5129
        ? e.id
        : `${e.kind}:${e.pubkey}:${e.kind === 35129 ? (tags(e, 'd')[0]?.[1] ?? '') : ''}`
    const previous = map.get(key)
    if (
      !previous ||
      e.created_at > previous.created_at ||
      (e.created_at === previous.created_at && e.id < previous.id)
    )
      map.set(key, e)
  }
  return [...map.values()]
    .filter(isLegacy)
    .sort((a, b) => b.created_at - a.created_at)
}
