<template>
  <div class="min-h-screen bg-gray-900 text-gray-100">
    <header class="bg-gray-800 border-b border-gray-700">
      <div class="container mx-auto px-4 py-3">
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-semibold flex items-center gap-2">
            <span class="text-2xl">🤖</span>
            Claude Workspace
            <span class="text-sm text-gray-400">@ {{ username }}</span>
          </h1>
          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-400">Status:</span>
            <span :class="statusClass" class="text-sm font-medium">
              {{ connectionStatus }}
            </span>
            <button
              @click="logout"
              class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
    
    <main class="container mx-auto p-4 flex flex-col" style="height: calc(100vh - 64px);">
      <div class="bg-gray-800 rounded-lg shadow-xl overflow-hidden flex flex-col flex-1">
        <div class="bg-gray-700 px-4 py-2 flex items-center justify-between">
          <span class="text-sm font-medium">Terminal</span>
          <div class="flex gap-2">
            <button 
              @click="reconnect" 
              v-if="connectionStatus === 'Disconnected'"
              class="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded"
            >
              Reconnect
            </button>
            <button 
              @click="restartContainer" 
              class="text-xs bg-orange-600 hover:bg-orange-700 px-3 py-1 rounded"
              title="Restart the entire container (useful after updates)"
            >
              Restart Container
            </button>
          </div>
        </div>
        <div ref="terminalContainer" class="p-4 flex-1"></div>
        <!-- Mobile input helper -->
        <div v-if="isMobile" class="p-4 border-t border-gray-700">
          <form @submit.prevent="sendMobileInput" class="flex gap-2">
            <input 
              v-model="mobileInput"
              type="text"
              placeholder="Type command here..."
              class="flex-1 bg-gray-700 text-gray-100 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              autocapitalize="off"
              autocorrect="off"
              autocomplete="off"
            >
            <button 
              type="submit"
              class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium"
            >
              Send
            </button>
          </form>
        </div>
      </div>
      
      <div class="mt-4 text-center text-sm text-gray-500">
        <p>💡 Claude CLI is running in this terminal. Type <code class="bg-gray-800 px-1 rounded">/help</code> for commands.</p>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

// OAuth uses cookies, no URL session handling needed

// Check authentication
const { data: session } = await useFetch('/api/session')
if (!session.value?.authenticated) {
  await navigateTo('/login')
}

const username = ref(session.value?.username || 'unknown')
const terminalContainer = ref(null)
const connectionStatus = ref('Connecting')
const terminal = ref(null)
const fitAddon = ref(null)
const ws = ref(null)
const mobileInput = ref('')
const isMobile = ref(false)

const statusClass = computed(() => {
  switch (connectionStatus.value) {
    case 'Connected':
      return 'text-green-400'
    case 'Connecting':
      return 'text-yellow-400'
    case 'Disconnected':
      return 'text-red-400'
    default:
      return 'text-gray-400'
  }
})

const logout = async () => {
  if (ws.value) {
    ws.value.close()
  }
  await $fetch('/api/logout', { method: 'POST' })
  // Clear session from sessionStorage (for local dev)
  sessionStorage.removeItem('sessionId')
  await navigateTo('/login')
}

const initTerminal = () => {
  // Detect mobile device
  isMobile.value = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  
  terminal.value = new Terminal({
    cursorBlink: true,
    fontSize: isMobile.value ? 16 : 14,
    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
    scrollback: 1000,
    // Disable mobile keyboard handling to prevent duplication
    rendererType: 'canvas',
    allowTransparency: false,
    // Better mobile support
    macOptionIsMeta: true,
    // Ensure proper line height
    lineHeight: 1.2,
    theme: {
      background: '#1f2937',
      foreground: '#e5e7eb',
      cursor: '#60a5fa',
      black: '#374151',
      red: '#ef4444',
      brightRed: '#f87171',
      green: '#10b981',
      brightGreen: '#34d399',
      yellow: '#f59e0b',
      brightYellow: '#fbbf24',
      blue: '#3b82f6',
      brightBlue: '#60a5fa',
      magenta: '#8b5cf6',
      brightMagenta: '#a78bfa',
      cyan: '#06b6d4',
      brightCyan: '#22d3ee',
      white: '#e5e7eb',
      brightWhite: '#f9fafb'
    }
  })
  
  fitAddon.value = new FitAddon()
  terminal.value.loadAddon(fitAddon.value)
  terminal.value.loadAddon(new WebLinksAddon())
  
  terminal.value.open(terminalContainer.value)
  fitAddon.value.fit()
  
  // Focus on terminal
  terminal.value.focus()
}

const connectWebSocket = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // OAuth uses cookies, local dev may use sessionStorage  
  const sessionId = sessionStorage.getItem('sessionId')
  const wsUrl = sessionId 
    ? `${protocol}//${window.location.host}/ws?session=${sessionId}`
    : `${protocol}//${window.location.host}/ws`
  ws.value = new WebSocket(wsUrl)
  
  ws.value.onopen = () => {
    connectionStatus.value = 'Connected'
    terminal.value.clear()
  }
  
  ws.value.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === 'stdout') {
      terminal.value.write(data.data)
    } else if (data.type === 'exit') {
      connectionStatus.value = 'Disconnected'
      terminal.value.write('\r\n\r\n[Process exited]\r\n')
    }
  }
  
  ws.value.onclose = () => {
    connectionStatus.value = 'Disconnected'
  }
  
  ws.value.onerror = (error) => {
    console.error('WebSocket error:', error)
    connectionStatus.value = 'Disconnected'
  }
  
  // Send terminal input to server
  terminal.value.onData((data) => {
    if (ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({ type: 'stdin', data }))
    }
  })
}

const reconnect = () => {
  if (ws.value) {
    ws.value.close()
  }
  connectionStatus.value = 'Connecting'
  terminal.value.clear()
  connectWebSocket()
}

const restartContainer = async () => {
  if (confirm('This will restart the entire container. Any unsaved work will be lost. Continue?')) {
    try {
      const response = await $fetch('/api/restart', { method: 'POST' })
      if (response.ok) {
        terminal.value.write('\r\n🔄 Container restart initiated...\r\n')
        // Wait a moment then reload the page
        setTimeout(() => {
          window.location.reload()
        }, 3000)
      } else {
        terminal.value.write('\r\n❌ Failed to restart container\r\n')
      }
    } catch (error) {
      terminal.value.write('\r\n❌ Error: ' + error.message + '\r\n')
    }
  }
}

const sendMobileInput = () => {
  if (mobileInput.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify({ type: 'stdin', data: mobileInput.value + '\n' }))
    mobileInput.value = ''
  }
}

const handleResize = () => {
  if (fitAddon.value) {
    fitAddon.value.fit()
  }
}

onMounted(() => {
  initTerminal()
  connectWebSocket()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (ws.value) {
    ws.value.close()
  }
  if (terminal.value) {
    terminal.value.dispose()
  }
  window.removeEventListener('resize', handleResize)
})
</script>

<style>
.xterm {
  height: 100%;
}

/* Mobile-specific styles */
@media (max-width: 768px) {
  .xterm {
    height: 100%;
  }
  
  /* Prevent zoom on input focus on iOS */
  input[type="text"] {
    font-size: 16px !important;
  }
}
</style>