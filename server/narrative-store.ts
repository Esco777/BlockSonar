import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NarrativeSnapshot, NarrativeEvidence, NarrativeCategory, NarrativeToken } from '../src/lib/early-narrative.js'
export type NarrativeState = { snapshot: NarrativeSnapshot; evidence: NarrativeEvidence[]; categories: NarrativeCategory[]; tokenCache: Record<string, { at: number; tokens: NarrativeToken[] }>; quotes: Array<{ time: number; prices: Record<string, number> }> }
export class NarrativeStore {
  constructor(private filename: string) {}
  async load(): Promise<NarrativeState | null> {
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8')) as NarrativeState
      if (value?.snapshot?.version !== 1 || !Array.isArray(value.snapshot.narratives) || !Array.isArray(value.evidence) || !Array.isArray(value.categories) || !value.tokenCache || !Array.isArray(value.quotes)) throw new Error('Invalid narrative history file')
      return value
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async save(state: NarrativeState) {
    await mkdir(path.dirname(this.filename), { recursive: true })
    const temporary = `${this.filename}.tmp`
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await rename(temporary, this.filename)
  }
}
