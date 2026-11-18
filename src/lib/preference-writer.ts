export type SaveStatus = { error: string; unsaved: boolean }
export class PreferenceWriter<T> {
  private version = 0
  private saved = 0
  private pending?: Promise<void>
  private error = ''
  constructor(private kind: string, private owner: string, private revision: number, private value: T, private notify: (status: SaveStatus) => void, private fetcher: typeof fetch = fetch) {}
  private status() { this.notify({ error: this.error, unsaved: this.version !== this.saved }) }
  update(value: T) { this.value = value; this.version++; this.status(); void this.flush() }
  retry() { this.error = ''; this.status(); void this.flush() }
  flush(): Promise<void> {
    if (this.pending) return this.pending
    if (this.error || this.version === this.saved) return Promise.resolve()
    this.pending = this.save().finally(() => { this.pending = undefined })
    return this.pending
  }
  private async save() {
    try {
      while (this.version !== this.saved) {
        const version = this.version, body = JSON.stringify({ owner: this.owner, revision: this.revision, value: this.value })
        const response = await this.fetcher(`/api/preferences/${this.kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: new TextEncoder().encode(body).length < 60000, signal: AbortSignal.timeout(15000) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Private lists could not be saved')
        this.revision = result.revision; this.saved = version; this.status()
      }
    } catch (error) { this.error = error instanceof Error ? error.message : 'Private save failed'; this.status() }
  }
  dispose() { this.notify = () => {}; void this.flush() }
}
