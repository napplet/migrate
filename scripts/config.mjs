export const fields = [
  {
    name: 'BUNNY_STORAGE_ZONE',
    kind: 'variable',
    description:
      'Storage zone name. Bunny dashboard → Storage → your zone → FTP & API access.',
    validate: (v) => /^[a-zA-Z0-9_-]+$/.test(v),
  },
  {
    name: 'BUNNY_STORAGE_HOST',
    kind: 'variable',
    default: 'storage.bunnycdn.com',
    description:
      'Primary-region storage hostname (no https://). Copy Hostname from Storage → FTP & API access. Example: storage.bunnycdn.com or ny.storage.bunnycdn.com.',
    validate: (v) => /^(?:[a-z]{2,4}\.)?storage\.bunnycdn\.com$/.test(v),
  },
  {
    name: 'BUNNY_STORAGE_PASSWORD',
    kind: 'secret',
    description:
      'Storage zone password / API AccessKey. Storage → your zone → FTP & API access → Password. Use the writable storage password, not the read-only password or account API key.',
    validate: (v) => !!v.trim(),
  },
  {
    name: 'BUNNY_PULL_ZONE_ID',
    kind: 'variable',
    description:
      'Numeric pull zone ID. CDN → your pull zone; the number in its dashboard URL. Connect this pull zone to the storage zone first.',
    validate: (v) => /^\d+$/.test(v),
  },
  {
    name: 'BUNNY_API_KEY',
    kind: 'secret',
    description:
      'Bunny account API key for cache purging. Account settings → API. This is different from the storage password.',
    validate: (v) => !!v.trim(),
  },
]
export function deploymentConfig(env) {
  const config = {}
  for (const f of fields) {
    const value = env[f.name] ?? f.default
    if (!value || !f.validate(value))
      throw new Error(`Missing or invalid ${f.name}. Run npm run setup:github.`)
    config[f.name] = value
  }
  return config
}
