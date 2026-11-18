import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/operations': { target: 'http://127.0.0.1:4001' },
      '/api/preferences': { target: 'http://127.0.0.1:4001' },
      '/api/market': { target: 'http://127.0.0.1:4001' },
      '/api/membership': { target: 'http://127.0.0.1:4001' },
      '/api/auth': { target: 'http://127.0.0.1:4001' },
      '/api/liquidity': { target: 'http://127.0.0.1:4001' },
      '/api/dex': { target: 'http://127.0.0.1:4001' },
      '/api/chains': { target: 'http://127.0.0.1:4001' },
      '/api/data/coverage': { target: 'http://127.0.0.1:4001' },
      '/api/notifications': { target: 'http://127.0.0.1:4001' },
      '/api/discovery': { target: 'http://127.0.0.1:4001' },
      '/api/wallet-tracker': { target: 'http://127.0.0.1:4001' },
      '/api/intelligence': { target: 'http://127.0.0.1:4001' },
      '/api/narratives': { target: 'http://127.0.0.1:4001' },
      '/api/liquidity/stream': {
        target: 'http://127.0.0.1:4001',
        rewrite: (path) => path.replace('/api/liquidity/stream', '/stream'),
      },
    },
  },
})
