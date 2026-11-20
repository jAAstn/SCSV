export type SortDirection = 'none' | 'desc' | 'asc'

/**
 * Compares two items by their known byte size. Items without a size always
 * sort last, regardless of direction.
 */
export function compareBySize(
  aId: string,
  bId: string,
  sizes: Record<string, number | string>,
  direction: SortDirection
): number {
  const aSize = typeof sizes[aId] === 'number' ? (sizes[aId] as number) : null
  const bSize = typeof sizes[bId] === 'number' ? (sizes[bId] as number) : null

  if (aSize === null) return bSize === null ? 0 : 1
  if (bSize === null) return -1

  return (aSize - bSize) * (direction === 'asc' ? 1 : -1)
}

/** Builds an id -> position lookup from the order captured when the page loaded. */
export function buildOrderRank(originalOrder: string[]): Map<string, number> {
  const rank = new Map<string, number>()
  originalOrder.forEach((id, index) => {
    if (id && !rank.has(id)) rank.set(id, index)
  })
  return rank
}

/** Restores the original Steam order. Unknown ids go last. */
export function compareByOriginalOrder(
  aId: string,
  bId: string,
  rank: Map<string, number>
): number {
  const aRank = rank.get(aId) ?? Number.MAX_SAFE_INTEGER
  const bRank = rank.get(bId) ?? Number.MAX_SAFE_INTEGER
  return aRank - bRank
}
