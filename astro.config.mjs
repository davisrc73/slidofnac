import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import { createSlidoApiPlugin } from './src/lib/slido-server.mjs';

export default defineConfig({
  integrations: [tailwind()],
  vite: {
    plugins: [createSlidoApiPlugin()],
  },
});
