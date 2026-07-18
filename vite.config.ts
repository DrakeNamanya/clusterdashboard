import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  // `pg` reaches for the real Cloudflare TCP socket via pg-cloudflare's
  // "workerd" export condition. Without listing it here, Vite's SSR resolver
  // falls back to pg-cloudflare's "default" export (an empty stub), so
  // `new CloudflareSocket()` throws "f is not a constructor" at runtime.
  // Forcing the `workerd` condition makes the real CloudflareSocket bundle.
  resolve: {
    conditions: ['workerd', 'worker', 'module', 'import', 'default'],
  },
  ssr: {
    resolve: {
      conditions: ['workerd', 'worker', 'module', 'import', 'default'],
    },
    // `cloudflare:sockets` is a Workers runtime built-in (used by pg-cloudflare
    // for native TCP). It must stay external so the bundler doesn't try to
    // resolve it from disk.
    external: ['cloudflare:sockets'],
  },
  build: {
    rollupOptions: {
      external: ['cloudflare:sockets'],
    },
  },
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
