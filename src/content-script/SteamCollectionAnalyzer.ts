import browser from 'webextension-polyfill'

import { SteamAPI, SteamAPIResponse } from '../shared/SteamAPI'
import { CollectionService } from '../shared/CollectionService'
import { SizeCache } from '../shared/SizeCache'
import { FileFormatter } from '../utils/formatter'
import { copyText } from '../utils/clipboard'
import {
  buildOrderRank,
  compareByOriginalOrder,
  compareBySize,
  SortDirection,
} from '../utils/sorting'
import { renderItemSizes } from './itemSizes'

interface ItemSize {
  [key: string]: number | string
}

export class SteamCollectionAnalyzer {
  private currentUrl = new URL(window.location.href)
  private id = this.currentUrl.searchParams.get('id')
  private useGB = false
  private itemSizes: ItemSize = {}
  private itemTitles: Record<string, string> = {}
  private uniqueItems: string[] = []
  private duplicateCount = 0
  private sortDirection: SortDirection = 'none'
  private originalOrder: string[] = []
  private observer: MutationObserver | null = null
  private sortTimer: number | undefined
  private statusNote: HTMLSpanElement | null = null
  private liveRegion: HTMLSpanElement | null = null

  async init() {
    if (!this.id) {
      console.info('ID parameter not found in URL')
      return
    }

    await this.loadSettings()

    const isCollectionPage = await this.checkIfPageIsCollection()
    if (!isCollectionPage) {
      console.debug('Not a collection page')
      return
    }

    await this.createUI()
  }

  private async loadSettings() {
    try {
      const result = await browser.storage.local.get('useGB')
      this.useGB = typeof result.useGB === 'boolean' ? result.useGB : false
    } catch (error) {
      console.warn('Error loading settings:', error)
      this.useGB = false
    }
  }

  private async checkIfPageIsCollection(): Promise<boolean> {
    if (!this.id) return false

    if (document.querySelector('.collectionChildren')) {
      return true
    }

    try {
      const response = await fetch(
        'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            collectioncount: '1',
            'publishedfileids[0]': this.id,
          }),
        }
      )

      if (response.ok) {
        const data: SteamAPIResponse = await response.json()
        return !!(data.response?.collectiondetails?.[0]?.children)
      }
    } catch (error) {
      console.error('Error checking collection:', error)
    }

    return false
  }

  private async createUI() {
    const buttonLocations = Array.from(
      document.querySelectorAll('.workshopItemDescriptionTitle')
    )

    let buttonLocation = buttonLocations.find(div => div.textContent?.includes('Items'))

    if (!buttonLocation) {
      buttonLocation = buttonLocations[1] || buttonLocations[0]
    }

    if (!buttonLocation) {
      console.debug('Button container not found')
      return
    }

    const calcButton = this.createButton(browser.i18n.getMessage('content_calc_size'), '_calc _calcSpan')
    const likeAllButton = this.createButton(browser.i18n.getMessage('content_like_all'), '_likeAll')
    const sortButton = this.createButton(this.getSortLabel('none'), '_sort')
    sortButton.disabled = true
    sortButton.setAttribute('aria-pressed', 'false')
    sortButton.title =
      browser.i18n.getMessage('content_sort_hint') || 'Calculate the size first, then sort by file size'

    const statusNote = document.createElement('span')
    statusNote.className = 'scsv-note'
    statusNote.hidden = true
    this.statusNote = statusNote

    const liveRegion = document.createElement('span')
    liveRegion.className = 'scsv-sr-only'
    liveRegion.setAttribute('role', 'status')
    liveRegion.setAttribute('aria-live', 'polite')
    this.liveRegion = liveRegion

    try {
      const allItems = await this.getAllItems()
      this.uniqueItems = Array.from(new Set(allItems))
      this.duplicateCount = Math.max(0, allItems.length - this.uniqueItems.length)
      this.originalOrder = this.getCurrentItemOrder()

      this.setupCalculateButton(calcButton, this.uniqueItems, sortButton)
      this.setupSortButton(sortButton)
      await this.setupLikeAllButton(likeAllButton, this.uniqueItems)
      this.updateStatus(0)
      await this.applyCachedSizes(sortButton, calcButton)
      void this.writeLastCollection()

      buttonLocation.appendChild(calcButton)
      buttonLocation.appendChild(sortButton)
      buttonLocation.appendChild(likeAllButton)
      buttonLocation.appendChild(statusNote)
      buttonLocation.appendChild(liveRegion)

      this.setupObserver()
    } catch (error) {
      console.error('Error creating UI:', error)
    }
  }

  private createButton(text: string, className: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `general_btn scsv-design ${className}`
    button.textContent = text
    return button
  }

  private setupCalculateButton(
    button: HTMLButtonElement,
    allItems: string[],
    sortButton: HTMLButtonElement
  ) {
    button.onclick = async () => {
      if (button.classList.contains('scsv-loading')) return

      if (allItems.length > 0) {
        button.classList.add('scsv-loading')
        try {
          const result = await SteamAPI.calculateWorkshopItemsSize(allItems)
          this.itemSizes = result.itemSizes
          this.itemTitles = { ...this.itemTitles, ...result.itemTitles }

          await SizeCache.setMany(this.collectCacheEntries(result))
          this.displayItemSizes(result.itemSizes)

          sortButton.disabled = false
          sortButton.title =
            browser.i18n.getMessage('content_sort_click') || 'Click to change the sorting order'
          this.updateStatus(result.failedIds.length)

          const totalSize = FileFormatter.formatSteamSizeWithUnit(result.totalSizeBytes, this.useGB)

          button.textContent = totalSize
          button.title =
            browser.i18n.getMessage('content_refresh_hint') || 'Click to refresh'
          button.classList.remove('scsv-loading')
          button.classList.add('scsv-success')
          if (this.liveRegion) this.liveRegion.textContent = totalSize

          if (await copyText(totalSize)) {
            this.showToast(browser.i18n.getMessage('content_copied') || 'Copied')
          }

          setTimeout(() => {
            button.classList.remove('scsv-success')
          }, 2000)

          if (this.sortDirection !== 'none') this.applySort()
        } catch (error) {
          console.error('Error calculating size:', error)
          button.textContent = browser.i18n.getMessage('content_error')
          button.classList.remove('scsv-loading')
          button.classList.add('scsv-error')

          setTimeout(() => {
            button.classList.remove('scsv-error')
            button.textContent = browser.i18n.getMessage('content_calc_size')
          }, 3000)
        }
      } else {
        console.debug('No workshop items found')
      }
    }
  }

  private collectCacheEntries(result: {
    itemSizes: Record<string, number | string>
    itemTitles: Record<string, string>
  }): Record<string, { bytes: number; title?: string }> {
    const entries: Record<string, { bytes: number; title?: string }> = {}

    Object.entries(result.itemSizes).forEach(([id, size]) => {
      if (typeof size === 'number') {
        entries[id] = { bytes: size, title: result.itemTitles[id] }
      }
    })

    return entries
  }

  private async applyCachedSizes(sortButton: HTMLButtonElement, calcButton: HTMLButtonElement) {
    if (this.uniqueItems.length === 0) return

    const cached = await SizeCache.getMany(this.uniqueItems)
    const knownIds = Object.keys(cached.sizes)
    if (knownIds.length === 0) return

    this.itemSizes = { ...cached.sizes }
    this.itemTitles = { ...cached.titles }
    this.displayItemSizes(this.itemSizes)

    sortButton.disabled = false
    sortButton.title =
      browser.i18n.getMessage('content_sort_click') || 'Click to change the sorting order'

    const fullyCached = this.uniqueItems.every(id => typeof cached.sizes[id] === 'number')
    if (fullyCached) {
      const totalBytes = this.uniqueItems.reduce((sum, id) => sum + (cached.sizes[id] ?? 0), 0)
      calcButton.textContent = FileFormatter.formatSteamSizeWithUnit(totalBytes, this.useGB)
      calcButton.title =
        browser.i18n.getMessage('content_cached_hint') || 'From cache – click to refresh'
    }

    const stored = await browser.storage.local.get(this.sortStorageKey)
    const direction = stored[this.sortStorageKey]
    if (direction === 'desc' || direction === 'asc' || direction === 'none') {
      this.setSortDirection(direction, sortButton)
    }
  }

  private setupSortButton(button: HTMLButtonElement) {
    button.onclick = () => {
      if (button.disabled) return

      const next: SortDirection =
        this.sortDirection === 'desc' ? 'asc' : this.sortDirection === 'asc' ? 'none' : 'desc'

      this.setSortDirection(next, button)
      void browser.storage.local.set({ [this.sortStorageKey]: next })
      if (this.liveRegion) this.liveRegion.textContent = this.getSortLabel(next)
    }
  }

  private setSortDirection(direction: SortDirection, button: HTMLButtonElement) {
    this.sortDirection = direction
    button.textContent = this.getSortLabel(direction)
    button.setAttribute('aria-pressed', String(direction !== 'none'))
    button.title =
      browser.i18n.getMessage('content_sort_click') || 'Click to change the sorting order'
    this.applySort()
  }

  private getSortLabel(direction: SortDirection): string {
    if (direction === 'desc') {
      return browser.i18n.getMessage('content_sort_large') || 'Sort: Large → Small'
    }
    if (direction === 'asc') {
      return browser.i18n.getMessage('content_sort_small') || 'Sort: Small → Large'
    }
    return browser.i18n.getMessage('content_sort_default') || 'Sort: Default'
  }

  private get sortStorageKey(): string {
    return `scsv_sort_${this.id ?? 'unknown'}`
  }

  private getCurrentItemOrder(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.collectionItem')).map(item =>
      item.id.replace('sharedfile_', '')
    )
  }

  private applySort() {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.collectionItem'))
    if (items.length === 0) return

    const itemsByParent = new Map<HTMLElement, HTMLElement[]>()
    items.forEach(item => {
      const parent = item.parentElement
      if (!parent) return
      const siblings = itemsByParent.get(parent)
      if (siblings) {
        siblings.push(item)
      } else {
        itemsByParent.set(parent, [item])
      }
    })

    const direction = this.sortDirection
    const rank = buildOrderRank(this.originalOrder)

    itemsByParent.forEach((siblings, parent) => {
      const sorted = siblings.slice().sort((a, b) => {
        const aId = a.id.replace('sharedfile_', '')
        const bId = b.id.replace('sharedfile_', '')
        return direction === 'none'
          ? compareByOriginalOrder(aId, bId, rank)
          : compareBySize(aId, bId, this.itemSizes, direction)
      })

      if (sorted.every((item, index) => item === siblings[index])) return

      const fragment = document.createDocumentFragment()
      sorted.forEach(item => fragment.appendChild(item))
      parent.appendChild(fragment)
    })
  }

  private setupObserver() {
    this.observer?.disconnect()

    this.observer = new MutationObserver(() => {
      if (this.sortDirection === 'none') return
      window.clearTimeout(this.sortTimer)
      this.sortTimer = window.setTimeout(() => this.applySort(), 150)
    })

    if (document.body) {
      this.observer.observe(document.body, { childList: true, subtree: true })
    }
  }

  private updateStatus(failedCount: number) {
    if (!this.statusNote) return

    const parts: string[] = []
    if (this.duplicateCount > 0) {
      parts.push(
        `${this.duplicateCount} ${browser.i18n.getMessage('content_duplicates') || 'duplicates'}`
      )
    }
    if (failedCount > 0) {
      parts.push(
        `${failedCount} ${browser.i18n.getMessage('content_missing_sizes') || 'without size'}`
      )
    }

    this.statusNote.textContent = parts.join(' · ')
    this.statusNote.title =
      failedCount > 0
        ? browser.i18n.getMessage('content_missing_sizes_hint') ||
          'Private, deleted or API errors – the total only includes available items.'
        : ''
    this.statusNote.hidden = parts.length === 0
  }

  private showToast(text: string) {
    if (!text) return

    const toast = document.createElement('span')
    toast.className = 'scsv-toast'
    toast.textContent = text
    document.body.appendChild(toast)

    setTimeout(() => toast.remove(), 1800)
  }

  private getCollectionTitle(): string {
    const titleElement = Array.from(document.querySelectorAll<HTMLElement>('.workshopItemTitle')).find(
      element => !element.closest('.collectionItem')
    )
    const clone = titleElement?.cloneNode(true) as HTMLElement | undefined
    clone?.querySelector('.item-size')?.remove()

    const title = clone?.textContent?.trim()
    if (title) return title

    return document.title.replace(/^Steam Workshop\s*::\s*/, '').trim() || this.id || ''
  }

  private async writeLastCollection() {
    if (!this.id || this.uniqueItems.length === 0) return

    try {
      await browser.storage.local.set({
        scsv_last_collection: {
          id: this.id,
          title: this.getCollectionTitle(),
          itemIds: this.uniqueItems,
          ts: Date.now(),
        },
      })
    } catch (error) {
      console.warn('Could not store last collection:', error)
    }
  }

  private async setupLikeAllButton(button: HTMLButtonElement, allItems: string[]) {
    button.onclick = async () => {
      if (button.classList.contains('scsv-loading')) return

      if (allItems.length > 0) {
        button.classList.add('scsv-loading')
        try {
          const liked = await this.likeAllItems(allItems, (current, total) => {
            button.setAttribute('data-progress', `${current}/${total}`)
          })

          button.classList.remove('scsv-loading')
          button.removeAttribute('data-progress')

          if (liked > 0) {
            button.textContent = `${browser.i18n.getMessage('content_liked')} ${liked}`
            button.classList.add('scsv-success')
          } else {
            button.textContent = browser.i18n.getMessage('content_like_all')
          }

          setTimeout(() => {
            button.classList.remove('scsv-success')
          }, 3000)
        } catch (error) {
          console.error('Error liking items:', error)
          button.textContent = browser.i18n.getMessage('content_error')
          button.classList.remove('scsv-loading')
          button.classList.add('scsv-error')

          setTimeout(() => {
            button.classList.remove('scsv-error')
            button.textContent = browser.i18n.getMessage('content_like_all')
          }, 3000)
        }
      } else {
        console.debug('No workshop items found')
      }
    }

    try {
      const user = await CollectionService.getCurrentUser()
      if (!user) return

      const storageKey = `likedItems_${user.steamId}_${this.id}`
      const result = await browser.storage.local.get(storageKey)
      const likedItems: string[] = Array.isArray(result[storageKey])
        ? (result[storageKey] as string[])
        : []

      const allLiked = allItems.every(item => likedItems.includes(item))

      if (allLiked && allItems.length > 0) {
        button.textContent = browser.i18n.getMessage('content_all_liked')
        button.style.opacity = '0.7'
      }
    } catch (error) {
      console.warn('Error checking liked status:', error)
    }
  }

  private async getAllItems(): Promise<string[]> {
    try {
      if (!this.id) return []

      const response = await fetch(
        'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            collectioncount: '1',
            'publishedfileids[0]': this.id,
          }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch collection details')
      }

      const data: SteamAPIResponse = await response.json()
      const collectionDetails = data.response?.collectiondetails

      if (!collectionDetails || collectionDetails.length === 0) {
        throw new Error('No collection details found')
      }

      const children = collectionDetails[0].children
      if (!children || children.length === 0) {
        throw new Error('Collection appears empty via API (might be private)')
      }

      return children.map(item => item.publishedfileid)
    } catch (error) {
      console.warn('Error with new method, falling back to old method:', error)
      return this.fallbackGetAllItems()
    }
  }

  private fallbackGetAllItems(): string[] {
    const itemsContainer = document.querySelector('.collectionChildren')
    const items: string[] = []

    if (itemsContainer) {
      const collectionItems = itemsContainer.querySelectorAll('div.collectionItem')
      for (const item of collectionItems) {
        if (item.id && item.id.startsWith('sharedfile_')) {
          const fileId = item.id.replace('sharedfile_', '')
          items.push(fileId)
        }
      }
    }

    return items
  }

  private displayItemSizes(itemSizes: ItemSize) {
    renderItemSizes('.collectionItem', itemSizes, item =>
      item.id.replace('sharedfile_', '') || null
    )
  }

  private async likeAllItems(
    workshopItemIds: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<number> {
    const user = await CollectionService.getCurrentUser()
    if (!user) {
      alert(browser.i18n.getMessage('content_login_required_like'))
      return 0
    }

    const sessionId = user.sessionId
    const storageKey = `likedItems_${user.steamId}_${this.id}`
    const result = await browser.storage.local.get(storageKey)
    const likedItems = new Set<string>(
      Array.isArray(result[storageKey]) ? (result[storageKey] as string[]) : []
    )

    let successCount = 0
    let failureCount = 0
    let status15Timestamps: number[] = []
    let processedCount = 0

    for (const itemId of workshopItemIds) {
      if (onProgress) onProgress(processedCount, workshopItemIds.length)

      if (likedItems.has(itemId)) {
        processedCount++
        continue
      }

      try {
        const response = await fetch('https://steamcommunity.com/sharedfiles/voteup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ sessionid: sessionId, id: itemId }),
        })

        if (!response.ok) {
          failureCount++
          continue
        }

        const data = await response.json()

        if (data.success === 15 || Object.values(data.results ?? {}).includes(15)) {
          failureCount++
          const now = Date.now()
          status15Timestamps.push(now)
          status15Timestamps = status15Timestamps.filter(ts => now - ts <= 5000)

          if (status15Timestamps.length >= 5) {
            alert(browser.i18n.getMessage('content_many_private'))
            break
          }
          continue
        }

        if (data.success === 1) {
          successCount++
          likedItems.add(itemId)
          await browser.storage.local.set({ [storageKey]: [...likedItems] })
        } else {
          failureCount++
        }
      } catch (error) {
        console.error(`Error liking item ${itemId}:`, error)
        failureCount++
      }
      processedCount++
    }

    if (onProgress) onProgress(processedCount, workshopItemIds.length)

    console.info(`Liked ${successCount} items, failed ${failureCount} times`)
    return successCount
  }
}
