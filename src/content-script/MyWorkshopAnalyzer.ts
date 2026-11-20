import browser from 'webextension-polyfill'

import { SteamAPI } from '../shared/SteamAPI'
import { SizeCache } from '../shared/SizeCache'
import { FileFormatter } from '../utils/formatter'
import { copyText } from '../utils/clipboard'
import {
  buildOrderRank,
  compareByOriginalOrder,
  compareBySize,
  SortDirection,
} from '../utils/sorting'
import { getWorkshopItemId, renderItemSizes } from './itemSizes'

interface WorkshopSizeMap {
  [key: string]: number | string
}

/**
 * Adds size calculation and sorting to the "my workshop files" pages.
 */
export class MyWorkshopAnalyzer {
  private useGB = false
  private itemSizes: WorkshopSizeMap = {}
  private itemTitles: Record<string, string> = {}
  private itemIds: string[] = []
  private originalOrder: string[] = []
  private sortDirection: SortDirection = 'none'
  private sortTimer: number | undefined
  private calcButton: HTMLButtonElement | null = null
  private sortButton: HTMLButtonElement | null = null
  private countElement: HTMLSpanElement | null = null
  private statusElement: HTMLSpanElement | null = null
  private liveElement: HTMLSpanElement | null = null

  async init() {
    if (!window.location.pathname.includes('/myworkshopfiles')) return

    await this.loadSettings()
    await this.waitForItems()
    this.refreshItems()
    if (this.itemIds.length === 0) return

    this.createPanel()
    await this.loadCachedSizes()
    this.setupObserver()
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

  private async waitForItems(timeout = 10000) {
    if (document.querySelector('.workshopItem')) return

    await new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.workshopItem')) {
          observer.disconnect()
          resolve()
        }
      })

      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true })
      }

      setTimeout(() => {
        observer.disconnect()
        resolve()
      }, timeout)
    })
  }

  private refreshItems() {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.workshopItem'))
    const ids = items.map(getWorkshopItemId).filter((id): id is string => !!id)

    this.itemIds = Array.from(new Set(ids))
    this.originalOrder = ids
    this.updateCount()
  }

  private getAppId(): string | null {
    const appId = new URLSearchParams(window.location.search).get('appid')
    if (appId) return appId

    const match = window.location.pathname.match(/\/app\/(\d+)/)
    return match ? match[1] : null
  }

  private get sortStorageKey(): string {
    return `scsv_sort_myworkshop_${this.getAppId() ?? 'all'}`
  }

  private createPanel() {
    const panel = document.createElement('div')
    panel.id = 'scsv-mw-panel'

    const title = document.createElement('div')
    title.className = 'scsv-panel-title'
    title.textContent = 'Steam Collection Size Viewer'

    const minimize = document.createElement('button')
    minimize.type = 'button'
    minimize.className = 'scsv-panel-minimize'
    minimize.setAttribute('aria-label', 'Minimize panel')
    minimize.setAttribute('aria-expanded', 'true')
    minimize.textContent = '—'
    title.appendChild(minimize)

    const panelBody = document.createElement('div')
    panelBody.className = 'scsv-panel-body'

    const calcButton = document.createElement('button')
    calcButton.type = 'button'
    calcButton.className = 'general_btn scsv-design'
    calcButton.textContent = browser.i18n.getMessage('content_calc_size')
    this.calcButton = calcButton

    const sortButton = document.createElement('button')
    sortButton.type = 'button'
    sortButton.className = 'general_btn scsv-design'
    sortButton.textContent = this.getSortLabel('none')
    sortButton.disabled = true
    sortButton.setAttribute('aria-pressed', 'false')
    sortButton.title =
      browser.i18n.getMessage('content_sort_hint') || 'Calculate the size first, then sort by file size'
    this.sortButton = sortButton

    const count = document.createElement('span')
    count.className = 'scsv-panel-count'
    this.countElement = count

    const status = document.createElement('span')
    status.className = 'scsv-note'
    status.hidden = true
    this.statusElement = status

    const live = document.createElement('span')
    live.className = 'scsv-sr-only'
    live.setAttribute('role', 'status')
    live.setAttribute('aria-live', 'polite')
    this.liveElement = live

    panelBody.append(calcButton, sortButton, count, status, live)
    panel.append(title, panelBody)
    document.body.appendChild(panel)

    this.updateCount()

    minimize.addEventListener('click', () => {
      const isHidden = panelBody.style.display === 'none'
      panelBody.style.display = isHidden ? 'flex' : 'none'
      minimize.setAttribute('aria-expanded', String(isHidden))
    })

    calcButton.addEventListener('click', () => {
      void this.calculate()
    })

    sortButton.addEventListener('click', () => {
      if (sortButton.disabled) return

      const next: SortDirection =
        this.sortDirection === 'desc' ? 'asc' : this.sortDirection === 'asc' ? 'none' : 'desc'

      this.setSortDirection(next)
      void browser.storage.local.set({ [this.sortStorageKey]: next })
      if (this.liveElement) this.liveElement.textContent = this.getSortLabel(next)
    })

    this.makeDraggable(panel, title)
  }

  private makeDraggable(panel: HTMLElement, handle: HTMLElement) {
    let dragging = false
    let offsetX = 0
    let offsetY = 0

    handle.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('.scsv-panel-minimize')) return
      dragging = true
      const rect = panel.getBoundingClientRect()
      offsetX = event.clientX - rect.left
      offsetY = event.clientY - rect.top
      event.preventDefault()
    })

    document.addEventListener('mousemove', event => {
      if (!dragging) return
      const left = Math.max(0, Math.min(event.clientX - offsetX, window.innerWidth - panel.offsetWidth))
      const top = Math.max(0, Math.min(event.clientY - offsetY, window.innerHeight - panel.offsetHeight))
      panel.style.left = `${left}px`
      panel.style.top = `${top}px`
      panel.style.right = 'auto'
    })

    document.addEventListener('mouseup', () => {
      dragging = false
    })
  }

  private updateCount() {
    if (!this.countElement) return
    const label = browser.i18n.getMessage('content_workshop_items') || 'Workshop Items'
    this.countElement.textContent = `${this.itemIds.length} ${label}`
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

  private setSortDirection(direction: SortDirection) {
    this.sortDirection = direction
    if (this.sortButton) {
      this.sortButton.textContent = this.getSortLabel(direction)
      this.sortButton.setAttribute('aria-pressed', String(direction !== 'none'))
      this.sortButton.title =
        browser.i18n.getMessage('content_sort_click') || 'Click to change the sorting order'
    }
    this.applySort()
  }

  private applySort() {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.workshopItem'))
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
        const aId = getWorkshopItemId(a) ?? ''
        const bId = getWorkshopItemId(b) ?? ''
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

  private async loadCachedSizes() {
    const cached = await SizeCache.getMany(this.itemIds)
    if (Object.keys(cached.sizes).length === 0) return

    this.itemSizes = { ...cached.sizes }
    this.itemTitles = { ...cached.titles }
    renderItemSizes('.workshopItem', this.itemSizes, getWorkshopItemId)

    if (this.sortButton) {
      this.sortButton.disabled = false
      this.sortButton.title =
        browser.i18n.getMessage('content_sort_click') || 'Click to change the sorting order'
    }

    const fullyCached = this.itemIds.every(id => typeof cached.sizes[id] === 'number')
    if (fullyCached && this.calcButton) {
      const totalBytes = this.itemIds.reduce((sum, id) => sum + (cached.sizes[id] ?? 0), 0)
      this.calcButton.textContent = FileFormatter.formatSteamSizeWithUnit(totalBytes, this.useGB)
      this.calcButton.title =
        browser.i18n.getMessage('content_cached_hint') || 'From cache – click to refresh'
    }

    const stored = await browser.storage.local.get(this.sortStorageKey)
    const direction = stored[this.sortStorageKey]
    if (direction === 'desc' || direction === 'asc' || direction === 'none') {
      this.setSortDirection(direction)
    }
  }

  private async calculate() {
    if (!this.calcButton || this.calcButton.classList.contains('scsv-loading')) return

    this.refreshItems()
    if (this.itemIds.length === 0) return

    this.calcButton.classList.add('scsv-loading')

    try {
      const result = await SteamAPI.calculateWorkshopItemsSize(this.itemIds)
      this.itemSizes = result.itemSizes
      this.itemTitles = { ...this.itemTitles, ...result.itemTitles }

      const entries: Record<string, { bytes: number; title?: string }> = {}
      Object.entries(result.itemSizes).forEach(([id, size]) => {
        if (typeof size === 'number') entries[id] = { bytes: size, title: result.itemTitles[id] }
      })
      await SizeCache.setMany(entries)

      renderItemSizes('.workshopItem', result.itemSizes, getWorkshopItemId)

      if (this.sortButton) {
        this.sortButton.disabled = false
        this.sortButton.title =
          browser.i18n.getMessage('content_sort_click') || 'Click to change the sorting order'
      }

      const total = FileFormatter.formatSteamSizeWithUnit(result.totalSizeBytes, this.useGB)
      this.calcButton.textContent = total
      this.calcButton.title =
        browser.i18n.getMessage('content_refresh_hint') || 'Click to refresh'
      this.calcButton.classList.add('scsv-success')

      if (this.liveElement) this.liveElement.textContent = total
      if (await copyText(total)) {
        this.showToast(browser.i18n.getMessage('content_copied') || 'Copied')
      }

      this.updateStatus(result.failedIds.length)

      setTimeout(() => this.calcButton?.classList.remove('scsv-success'), 2000)

      if (this.sortDirection !== 'none') this.applySort()
    } catch (error) {
      console.error('Error calculating size:', error)
      this.calcButton.textContent = browser.i18n.getMessage('content_error')
      this.calcButton.classList.add('scsv-error')

      setTimeout(() => {
        if (!this.calcButton) return
        this.calcButton.classList.remove('scsv-error')
        this.calcButton.textContent = browser.i18n.getMessage('content_calc_size')
      }, 3000)
    } finally {
      this.calcButton.classList.remove('scsv-loading')
    }
  }

  private updateStatus(failedCount: number) {
    if (!this.statusElement) return

    if (failedCount > 0) {
      const label = browser.i18n.getMessage('content_missing_sizes') || 'without size'
      this.statusElement.textContent = `${failedCount} ${label}`
      this.statusElement.title =
        browser.i18n.getMessage('content_missing_sizes_hint') ||
        'Private, deleted or API errors – the total only includes available items.'
      this.statusElement.hidden = false
    } else {
      this.statusElement.textContent = ''
      this.statusElement.title = ''
      this.statusElement.hidden = true
    }
  }

  private showToast(text: string) {
    if (!text) return

    const toast = document.createElement('span')
    toast.className = 'scsv-toast'
    toast.textContent = text
    document.body.appendChild(toast)

    setTimeout(() => toast.remove(), 1800)
  }

  private setupObserver() {
    const observer = new MutationObserver(() => {
      if (this.sortDirection === 'none') return
      window.clearTimeout(this.sortTimer)
      this.sortTimer = window.setTimeout(() => this.applySort(), 150)
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
    }
  }
}
