import { FileFormatter } from '../utils/formatter'

/** Reads the published file id from a workshop item card. */
export function getWorkshopItemId(item: HTMLElement): string | null {
  const dataElement = item.querySelector<HTMLElement>('[data-publishedfileid]')
  const dataId = dataElement?.getAttribute('data-publishedfileid')
  if (dataId && dataId !== '0') return dataId

  const link = item.querySelector<HTMLAnchorElement>("a[href*='filedetails/?id=']")
  if (link) {
    const match = link.href.match(/[?&]id=(\d+)/)
    if (match) return match[1]
  }

  return null
}

/** Adds (or refreshes) the size label inside each item's title. */
export function renderItemSizes(
  itemSelector: string,
  sizes: Record<string, number | string>,
  getItemId: (item: HTMLElement) => string | null
): void {
  document.querySelectorAll<HTMLElement>(itemSelector).forEach(item => {
    const itemId = getItemId(item)
    if (!itemId) return

    const titleElement = item.querySelector('.workshopItemTitle')
    if (!titleElement) return

    const existing = titleElement.querySelector('.item-size')
    const size = sizes[itemId]

    if (typeof size !== 'number') {
      if (existing) existing.remove()
      return
    }

    if (existing) existing.remove()

    const sizeSpan = document.createElement('span')
    sizeSpan.className = 'item-size'
    sizeSpan.textContent = `(${FileFormatter.formatSteamSize(size)})`
    titleElement.appendChild(sizeSpan)
  })
}
