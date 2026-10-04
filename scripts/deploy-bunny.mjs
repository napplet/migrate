import { readdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deploymentConfig } from './config.mjs'
async function files(root, prefix = '') {
  const found = []
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await files(root, path)))
    else if (entry.isFile()) found.push(path)
    else throw new Error('Deployment does not support symlinks.')
  }
  return found
}
export async function deploy({
  env = process.env,
  root = resolve('dist'),
  fetcher = fetch,
  log = console.log,
} = {}) {
  const config = deploymentConfig(env),
    paths = await files(root)
  if (!paths.includes('index.html'))
    throw new Error('Build output has no index.html. Run npm run build first.')
  // Upload hashed assets first; retain old assets for open tabs and cached HTML.
  paths.sort((a, b) =>
    a === 'index.html' ? 1 : b === 'index.html' ? -1 : a.localeCompare(b),
  )
  async function request(url, options) {
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetcher(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
      })
      if (response.ok) return
      if (response.status !== 429 && response.status < 500) break
      if (attempt < 2)
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
    throw new Error(
      `Bunny request failed (HTTP ${response.status}). Deployment stopped.`,
    )
  }
  for (const path of paths) {
    const body = await readFile(join(root, path))
    await request(
      `https://${config.BUNNY_STORAGE_HOST}/${encodeURIComponent(config.BUNNY_STORAGE_ZONE)}/${path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: config.BUNNY_STORAGE_PASSWORD,
          'Content-Type': 'application/octet-stream',
        },
        body,
      },
    )
    log(`Uploaded ${path}`)
  }
  await request(
    `https://api.bunny.net/pullzone/${config.BUNNY_PULL_ZONE_ID}/purgeCache`,
    { method: 'POST', headers: { AccessKey: config.BUNNY_API_KEY } },
  )
  log('Deployment complete. Pull zone cache purged.')
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  deploy().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
