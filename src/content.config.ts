import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		tags: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
		series: z.string().optional(),
		heroImage: z.string().optional(),
	}),
});

const projects = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
	schema: z.object({
		name: z.string(),
		description: z.string(),
		status: z.enum(['LIVE', 'WIP', 'ARCHIVED']),
		stack: z.array(z.string()),
		repo: z.string().url().optional(),
		demo: z.string().url().optional(),
		writeup: z.string().optional(),
		featured: z.boolean().default(false),
		order: z.number().default(0),
	}),
});

export const collections = { blog, projects };
