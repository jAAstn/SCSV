export interface SteamPublishedFileDetail {
  result: number
  publishedfileid: string
  file_size?: string
  title?: string
}

export interface SteamCollectionDetail {
  publishedfileid: string
  result: number
  children?: Array<{
    publishedfileid: string
    sortorder: number
    file_type: number
  }>
}

export interface SteamAPIResponse {
  response?: {
    result: number
    resultcount: number
    publishedfiledetails?: SteamPublishedFileDetail[]
    collectiondetails?: SteamCollectionDetail[]
  }
}

export interface WorkshopSizeResult {
  totalSizeBytes: number
  itemSizes: Record<string, number | string>
  itemTitles: Record<string, string>
  failedIds: string[]
}

export class SteamAPI {
  private static readonly CHUNK_SIZE = 100
  private static readonly REQUEST_TIMEOUT_MS = 15000
  private static readonly RETRY_DELAY_MS = 600

  /**
   * Calculates the total size of a list of Workshop item IDs in bytes and
   * returns the individual byte sizes, titles and failed ids for each item.
   * Failed chunks are retried once before their items are marked as failed.
   */
  static async calculateWorkshopItemsSize(items: string[]): Promise<WorkshopSizeResult> {
    let totalSizeBytes = 0
    const itemSizes: Record<string, number | string> = {}
    const itemTitles: Record<string, string> = {}
    const failedIds: string[] = []

    for (let i = 0; i < items.length; i += this.CHUNK_SIZE) {
      const chunk = items.slice(i, i + this.CHUNK_SIZE)
      let data: SteamAPIResponse | null = null

      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        try {
          data = await this.fetchChunk(chunk)
        } catch (error) {
          if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS))
          } else {
            console.error('Failed to fetch size for chunk:', error)
          }
        }
      }

      if (!data) {
        chunk.forEach(id => {
          itemSizes[id] = 'N/A'
          failedIds.push(id)
        })
        continue
      }

      const details = data.response?.publishedfiledetails ?? []
      details.forEach(item => {
        if (item.result === 1 && item.file_size) {
          const sizeBytes = parseInt(item.file_size)
          totalSizeBytes += sizeBytes
          itemSizes[item.publishedfileid] = sizeBytes
          if (item.title) itemTitles[item.publishedfileid] = item.title
        } else {
          itemSizes[item.publishedfileid] = 'N/A'
          failedIds.push(item.publishedfileid)
        }
      })

      chunk.forEach(id => {
        if (!(id in itemSizes)) {
          itemSizes[id] = 'N/A'
          failedIds.push(id)
        }
      })
    }

    return { totalSizeBytes, itemSizes, itemTitles, failedIds }
  }

  private static async fetchChunk(chunk: string[]): Promise<SteamAPIResponse> {
    const body = new URLSearchParams({
      itemcount: chunk.length.toString(),
    })

    chunk.forEach((id, index) => {
      body.append(`publishedfileids[${index}]`, id)
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(
        'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }
}
