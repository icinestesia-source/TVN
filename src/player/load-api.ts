let loading: Promise<void> | null = null

/** Loads the official IFrame Player API once. Does not scrape or call private endpoints. */
export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (loading) return loading

  loading = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube player API timed out'))
    }, 8000)

    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout)
      previous?.()
      resolve()
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('YouTube player API failed to load'))
    }
    document.head.appendChild(script)
  })

  loading = loading.catch((error: unknown) => {
    loading = null
    throw error
  })

  return loading
}
