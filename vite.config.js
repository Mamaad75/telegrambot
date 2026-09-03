import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

/**
 * Two build targets share one source tree:
 *   npm run dev    -> playground at index.html with a live tuning panel
 *   npm run build  -> single-file IIFE + ESM bundles written straight into the
 *                     WordPress plugin's assets folder, so the plugin is always
 *                     shipping the current source.
 */
export default defineConfig({
  plugins: [
    glsl({
      include: ['**/*.glsl'],
      // Shader minification is left off deliberately: the win is ~6KB before
      // gzip and the risk is a silently miscompiled shader on one GPU vendor.
      minify: false,
      removeDuplicatedImports: true,
      warnDuplicatedImports: false,
    }),
  ],
  build: {
    target: 'es2019',
    outDir: 'wordpress-plugin/particle-hero/assets/js',
    emptyOutDir: false,
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2, drop_debugger: true },
      format: { comments: false },
    },
    lib: {
      entry: 'src/index.js',
      name: 'ParticleHero',
      formats: ['iife', 'es'],
      fileName: (format) =>
        format === 'iife' ? 'particle-hero.min.js' : 'particle-hero.esm.js',
    },
    reportCompressedSize: true,
    rollupOptions: {
      output: { exports: 'named' },
    },
  },
});
