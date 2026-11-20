import browser from 'webextension-polyfill'

const CACHE_KEY = 'scsv_size_cache_v1'
const MAX_ENTRIES = 20000
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90

export interface CachedSize {
  b: number
  n?: string
  t: number
}

export type SizeCacheMap = Record<string, CachedSize>

export interface SizeCacheLookup {
  sizes: Record<string, number>
  titles: Record<string, string>
}

export class SizeCache {
  /** Returns the whole size cache (used by the popup overview). */
  static async getAll(): Promise<SizeCacheMap> {
    try {
      const result = await browser.storage.local.get(CACHE_KEY)
      const raw = result[CACHE_KEY]
      if (!raw || typeof raw !== 'object') return {}
      return raw as SizeCacheMap
    } catch (error) {
      console.warn('Could not read size cache:', error)
      return {}
    }
  }

  /** Returns cached sizes and titles for the requested item ids. */
  static async getMany(itemIds: string[]): Promise<SizeCacheLookup> {
    const all = await this.getAll()
    const sizes: Record<string, number> = {}
    const titles: Record<string, string> = {}

    itemIds.forEach(id => {
      const entry = all[id]
      if (!entry || typeof entry.b !== 'number') return
      sizes[id] = entry.b
      if (entry.n) titles[id] = entry.n
    })

    return { sizes, titles }
  }

  /** Stores sizes for items and prunes old/excess entries. */
  static async setMany(entries: Record<string, { bytes: number; title?: string }>): Promise<void> {
    const ids = Object.keys(entries)
    if (ids.length === 0) return

    try {
      const all = await this.getAll()
      const now = Date.now()

      ids.forEach(id => {
        all[id] = { b: entries[id].bytes, n: entries[id].title, t: now }
      })

      const cutoff = now - MAX_AGE_MS
      let kept = Object.entries(all).filter(([, entry]) => entry && typeof entry.b === 'number' && entry.t >= cutoff)

      if (kept.length > MAX_ENTRIES) {
        kept = kept.sort((a, b) => b[1].t - a[1].t).slice(0, MAX_ENTRIES)
      }

      const next: SizeCacheMap = {}
      kept.forEach(([id, entry]) => {
        next[id] = entry
      })

      await browser.storage.local.set({ [CACHE_KEY]: next })
    } catch (error) {
      console.warn('Could not write size cache:', error)
    }
  }
}
