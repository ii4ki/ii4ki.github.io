// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { remarkReadingTime } from './src/plugins/remark-reading-time.mjs';

// https://astro.build/config
export default defineConfig({
	site: 'https://ii4ki.github.io',
	base: '/',
	integrations: [mdx(), sitemap()],
	markdown: {
		remarkPlugins: [remarkReadingTime],
	},
});
