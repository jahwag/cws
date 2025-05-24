export default defineNuxtPlugin(() => {
  // Override $fetch to include session token from sessionStorage
  const originalFetch = $fetch.create({})
  
  globalThis.$fetch = $fetch.create({
    onRequest({ request, options }) {
      const sessionId = sessionStorage.getItem('sessionId')
      if (sessionId) {
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${sessionId}`
        }
      }
    }
  })
})