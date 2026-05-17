// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { remarkReadingTime } from './src/plugins/remark-reading-time.mjs';
import { rehypeCodeCopy } from './src/plugins/rehype-code-copy.mjs';
import { ii4kiDark, ii4kiLight } from './src/themes/shiki-ii4ki.mjs';

// https://astro.build/config
export default defineConfig({
	site: 'https://ii4ki.github.io',
	base: '/',
	integrations: [mdx(), sitemap()],
	markdown: {
		remarkPlugins: [remarkReadingTime],
		rehypePlugins: [rehypeCodeCopy],
		shikiConfig: {
			themes: {
				dark: ii4kiDark,
				light: ii4kiLight,
			},
			defaultColor: 'dark',
		},
	},
});
