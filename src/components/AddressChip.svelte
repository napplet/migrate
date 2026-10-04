<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { NostrEvent } from 'nostr-tools'
  import { nappletAddress } from '../lib/address'
  import { title } from '../lib/migration'

  let { event }: { event: NostrEvent } = $props()
  let address = $derived(nappletAddress(event))
  let copiedAddress = $state(''),
    failedAddress = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  async function copy() {
    const value = address
    if (!value) return
    clearTimeout(timer)
    copiedAddress = ''
    failedAddress = ''
    try {
      await navigator.clipboard.writeText(value)
      copiedAddress = value
      timer = setTimeout(() => (copiedAddress = ''), 1800)
    } catch {
      failedAddress = value
    }
  }
  onDestroy(() => clearTimeout(timer))
</script>

{#if address}
  <div class="address-copy">
    <button
      type="button"
      class="address-chip"
      title={address}
      aria-label={`Copy ${event.kind === 5129 ? 'nevent' : 'naddr'} for ${title(event)}`}
      onclick={copy}
    >
      <span aria-hidden="true">{copiedAddress === address ? '✓' : '⧉'}</span>
      <span
        >{copiedAddress === address
          ? 'Copied'
          : `${address.slice(0, 12)}…${address.slice(-8)}`}</span
      >
    </button>
    <span class="sr-only" role="status"
      >{copiedAddress === address ? 'Address copied to clipboard' : ''}</span
    >
    {#if failedAddress === address}
      <label class="hint"
        >Couldn’t copy automatically. Select and copy this address:
        <input
          readonly
          value={address}
          aria-label="Address to copy"
          onfocus={(e) => e.currentTarget.select()}
        />
      </label>
    {/if}
  </div>
{/if}
