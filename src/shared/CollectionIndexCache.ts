import browser from 'webextension-polyfill'
import type { SteamCollectionInfo } from './CollectionService'

export interface CollectionIndexEntry {
  id: string
  title: string
  count: number
  itemIds: string[]
}

export class CollectionIndexCache {
  static key(steamId: string): string {
    return `scsv_collections_cache_${steamId}`
  }

  static async save(steamId: string, collections: SteamCollectionInfo[]): Promise<void> {
    const index: CollectionIndexEntry[] = collections.map(collection => ({
      id: collection.publishedfileid,
      title: collection.title,
      count: collection.num_children,
      itemIds: Array.isArray(collection.children)
        ? collection.children.map(child => child.publishedfileid)
        : [],
    }))

    try {
      await browser.storage.local.set({ [this.key(steamId)]: index })
    } catch (error) {
      console.warn('Could not store collection index:', error)
    }
  }

  static async load(steamId: string): Promise<CollectionIndexEntry[]> {
    try {
      const result = await browser.storage.local.get(this.key(steamId))
      const stored = result[this.key(steamId)]
      return Array.isArray(stored) ? (stored as CollectionIndexEntry[]) : []
    } catch (error) {
      console.warn('Could not read collection index:', error)
      return []
    }
  }
}
