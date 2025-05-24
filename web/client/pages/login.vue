<template>
  <div class="min-h-screen bg-gray-900 flex items-center justify-center p-4">
    <div class="bg-gray-800 rounded-lg shadow-xl p-8 w-full max-w-md">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold flex items-center justify-center gap-2">
          <span class="text-3xl">🤖</span>
          Claude Workspace
        </h1>
        <p class="text-gray-400 mt-2">Sign in to continue</p>
      </div>

      <!-- OAuth login button -->
      <div v-if="oidcEnabled" class="mb-6">
        <a
          href="/auth/login"
          class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 rounded font-medium flex items-center justify-center gap-2 no-underline"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          Login with SSO
        </a>
      </div>

      <!-- Non-OAuth mode -->
      <div v-else class="text-center p-6">
        <p class="text-gray-400 mb-4">Running in local mode</p>
        <button
          @click="loginBypass"
          :disabled="loading"
          class="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded font-medium"
        >
          {{ loading ? 'Starting...' : 'Start Claude Workspace' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const oidcEnabled = ref(false)

// Check if OAuth is enabled
onMounted(async () => {
  try {
    const config = await $fetch('/api/auth/config')
    oidcEnabled.value = config.oidcEnabled
  } catch (err) {
    console.error('Failed to load auth config:', err)
  }
})

const loginBypass = async () => {
  loading.value = true
  error.value = ''

  try {
    const response = await $fetch('/api/login-bypass', {
      method: 'POST'
    })

    if (response.success) {
      await navigateTo('/')
    }
  } catch (err) {
    error.value = 'Failed to start workspace'
  } finally {
    loading.value = false
  }
}
</script>