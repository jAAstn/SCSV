/**
 * Copies text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a temporary textarea for browsers that block it (e.g. Brave).
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && document.hasFocus()) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy fallback below.
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}
