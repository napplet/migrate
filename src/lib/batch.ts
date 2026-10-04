import type { NostrEvent } from 'nostr-tools'
import { signMigration, type Session, type NappletRepository } from './nostr'
import type { Draft } from './migration'
export type Outcome = {
  id: string
  state: 'pending' | 'signing' | 'publishing' | 'success' | 'error'
  event?: NostrEvent
  accepted?: string[]
  failed?: string[]
  error?: string
}
export class MigrationBatch {
  outcomes: Outcome[]
  cancelled = false
  constructor(readonly drafts: Draft[]) {
    this.outcomes = drafts.map((d) => ({ id: d.original.id, state: 'pending' }))
  }
  cancel() {
    this.cancelled = true
  }
  async run(
    session: Session,
    repository: Pick<NappletRepository, 'publish'>,
    relays: string[],
    onchange: (values: Outcome[]) => void,
  ) {
    const emit = () => onchange(this.outcomes.map((o) => ({ ...o })))
    for (const [index, draft] of this.drafts.entries()) {
      if (this.cancelled) break
      const result = this.outcomes[index]
      if (result.state === 'success') continue
      try {
        if (!result.event) {
          result.state = 'signing'
          result.error = undefined
          emit()
          result.event = await signMigration(draft, session)
        }
        if (this.cancelled) break
        result.state = 'publishing'
        emit()
        const published = await repository.publish(result.event, relays)
        Object.assign(result, published, { state: 'success', error: undefined })
      } catch (e) {
        result.state = 'error'
        result.error = e instanceof Error ? e.message : String(e)
      }
      emit()
    }
  }
}
