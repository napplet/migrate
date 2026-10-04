import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fields } from './config.mjs'
export function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}
export async function configure({
  run = gh,
  ask,
  log = console.log,
  repo,
  environment = 'production',
}) {
  run(['auth', 'status'])
  repo ??= run([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ])
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error('Invalid GitHub repository.')
  if (!/^[\w-]+$/.test(environment))
    throw new Error(
      'Use a simple GitHub environment name (letters, numbers, dashes).',
    )
  log(
    `Configuring ${repo} → ${environment}. Existing values are retained on Enter. Secrets are never printed.`,
  )
  const environmentPath = `repos/${repo}/environments/${environment}`
  try {
    run(['api', environmentPath])
  } catch (error) {
    if (!String(error.stderr ?? error.message).includes('404')) throw error
    run(['api', '--method', 'PUT', environmentPath])
  }
  const options = ['--repo', repo, '--env', environment]
  const variables = JSON.parse(
    run(['variable', 'list', ...options, '--json', 'name,value']),
  )
  const secrets = JSON.parse(
    run(['secret', 'list', ...options, '--json', 'name']),
  )
  for (const field of fields) {
    const previous = variables.find((v) => v.name === field.name)?.value
    const exists =
      field.kind === 'secret'
        ? secrets.some((v) => v.name === field.name)
        : previous !== undefined
    log(`\n${field.name}\n${field.description}`)
    while (true) {
      const fallback = previous ?? field.default
      const answer = await ask(
        `${exists ? 'Enter to keep current' : fallback ? `Enter for ${fallback}` : 'Required'}${field.kind === 'secret' ? ' (hidden)' : ''}: `,
        field.kind === 'secret',
      )
      if (!answer && exists) {
        log('Kept existing value.')
        break
      }
      const value = answer || fallback
      if (!value || !field.validate(value)) {
        log('Invalid value. Please try again.')
        continue
      }
      if (field.kind === 'secret')
        run(['secret', 'set', field.name, ...options], value)
      else if (value !== previous)
        run(['variable', 'set', field.name, ...options, '--body', value])
      log('Saved.')
      break
    }
  }
  log(
    '\nReady. Push to main or run the Deploy workflow to deploy a tested build.',
  )
}
async function main() {
  if (!process.stdin.isTTY)
    throw new Error('Run this script in an interactive terminal.')
  let muted = false
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding)
      callback()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  rl.on('SIGINT', () => {
    rl.close()
    process.exit(130)
  })
  try {
    await configure({
      repo: process.env.GITHUB_REPOSITORY,
      environment: process.env.GITHUB_ENVIRONMENT || 'production',
      ask: async (prompt, secret) => {
        process.stdout.write(prompt)
        muted = secret
        try {
          return (await rl.question('')).trim()
        } finally {
          muted = false
          if (secret) process.stdout.write('\n')
        }
      },
    })
  } finally {
    rl.close()
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(
      e.message?.startsWith('Command failed:')
        ? 'GitHub CLI failed. Check gh auth status and repository admin permissions.'
        : e.message,
    )
    process.exitCode = 1
  })
