import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { sdkMulticoreWorkerHelpers } from '@namada/vite-esbuild-plugin'

import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill'
// import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill'
// import rollupNodePolyFill from 'rollup-plugin-polyfill-node'
// import wasm from "vite-plugin-wasm";
// import topLevelAwait from "vite-plugin-top-level-await";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // wasm(),
    // topLevelAwait(),
  ],
  server: {
    headers: {
      // Enable cross-origin isolation for SharedArrayBuffer
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      plugins: [
        sdkMulticoreWorkerHelpers(),
        NodeGlobalsPolyfillPlugin({
          buffer: true,
        }),
        // NodeModulesPolyfillPlugin(),
      ],
    },
  },
  worker: {
    // Ensure workers use ESM format to support code-splitting in production builds
    format: 'es',
  },
  // build: {
  //   rollupOptions: {
  //     plugins: [
  //       rollupNodePolyFill(),
  //     ],
  //   },
  // },
})
