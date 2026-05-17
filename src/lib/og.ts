import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const COLORS = {
	bg: '#0a0a0c',
	text: '#e6e6ea',
	muted: '#8a8a96',
	dim: '#44444f',
	border: '#2a2a33',
	accent: '#ffb000',
	green: '#3fb950',
};

let fontCache: { regular: Buffer; bold: Buffer } | null = null;

async function loadFonts() {
	if (fontCache) return fontCache;
	// This endpoint only runs at build time (prerendered), so the CWD is the project root.
	const root = process.cwd();
	const [regular, bold] = await Promise.all([
		readFile(resolve(root, 'src/assets/fonts/JetBrainsMono-Regular.ttf')),
		readFile(resolve(root, 'src/assets/fonts/JetBrainsMono-Bold.ttf')),
	]);
	fontCache = { regular, bold };
	return fontCache;
}

function titleFontSize(title: string): number {
	const len = title.length;
	if (len <= 20) return 96;
	if (len <= 32) return 84;
	if (len <= 44) return 68;
	return 56;
}

type Node = {
	type: string;
	props: Record<string, unknown> & { children?: unknown };
};

function el(type: string, props: Record<string, unknown> & { children?: unknown }): Node {
	return { type, props };
}

function template(title: string, description: string): Node {
	const titleSize = titleFontSize(title);

	// Logo SVG markup, inlined as a raw <svg> element tree.
	const logo = el('svg', {
		width: 132,
		height: 132,
		viewBox: '0 0 16 16',
		children: el('g', {
			fill: COLORS.accent,
			children: [
				el('path', {
					'fill-rule': 'evenodd',
					d: 'M3.5 0A3.5 3.5 0 0 0 0 3.5v9a3.5 3.5 0 0 0 7 0v-9A3.5 3.5 0 0 0 3.5 0Zm0 2A1.5 1.5 0 0 0 2 3.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 3.5 2Z',
				}),
				el('rect', { x: 2.5, y: 7.25, width: 2, height: 1.5, rx: 0.5 }),
				el('path', {
					'fill-rule': 'evenodd',
					d: 'M12.5 0A3.5 3.5 0 0 0 9 3.5v9a3.5 3.5 0 0 0 7 0v-9A3.5 3.5 0 0 0 12.5 0Zm0 2A1.5 1.5 0 0 0 11 3.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 12.5 2Z',
				}),
				el('rect', { x: 11.5, y: 7.25, width: 2, height: 1.5, rx: 0.5 }),
			],
		}),
	});

	// Scanlines layer (replaces ::before)
	const scanlines = el('div', {
		style: {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundImage:
				'repeating-linear-gradient(to bottom, rgba(230,230,234,0.08) 0px, rgba(230,230,234,0.08) 1px, transparent 1px, transparent 2px)',
		},
	});

	// Vignette layer (replaces ::after)
	const vignette = el('div', {
		style: {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundImage:
				'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.65) 100%)',
		},
	});

	const topStrip = el('div', {
		style: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'space-between',
			fontSize: 20,
			color: COLORS.dim,
			letterSpacing: 0.4,
			paddingBottom: 22,
			borderBottom: `1px solid ${COLORS.border}`,
		},
		children: [
			el('div', {
				style: { display: 'flex' },
				children: '[ ~/ii4ki ]',
			}),
			el('div', {
				style: { display: 'flex', color: COLORS.muted, fontSize: 18 },
				children: 'og-image · 1200×630',
			}),
		],
	});

	// Logo sits absolutely at the top-left of the title block, sized to match the
	// first line's cap height. `text-indent` pushes line 1 of the title past the logo;
	// subsequent wraps reclaim the full width — Satori honors text-indent on text nodes.
	const logoSize = Math.round(titleSize * 0.92);
	const logoGap = Math.round(titleSize * 0.55); // wider than letter gap so it reads as a separator
	const sizedLogo: Node = {
		type: 'svg',
		props: {
			...(logo.props as Record<string, unknown>),
			width: logoSize,
			height: logoSize,
			style: { position: 'absolute', top: 0, left: 0 },
		},
	};

	const lockup = el('div', {
		style: {
			position: 'relative',
			display: 'flex',
		},
		children: [
			sizedLogo,
			el('div', {
				style: {
					fontFamily: 'JetBrainsMono',
					fontWeight: 700,
					fontSize: titleSize,
					lineHeight: 1.05,
					letterSpacing: -titleSize * 0.01,
					color: COLORS.text,
					display: 'flex',
					flex: 1,
					textIndent: logoSize + logoGap,
					overflow: 'hidden',
				},
				children: title,
			}),
		],
	});

	const subhead = el('div', {
		style: {
			display: 'flex',
			fontFamily: 'JetBrainsMono',
			fontWeight: 400,
			fontSize: 34,
			lineHeight: 1.3,
			color: COLORS.text,
			letterSpacing: 0.17,
		},
		children: [
			el('span', {
				style: { color: COLORS.accent, marginRight: 14 },
				children: '>',
			}),
			el('span', {
				style: { display: 'flex', flex: 1 },
				children: description,
			}),
		],
	});

	const content = el('div', {
		style: {
			display: 'flex',
			flexDirection: 'column',
			flex: 1,
			justifyContent: 'center',
			gap: 28,
		},
		children: [lockup, subhead],
	});

	const bottomStrip = el('div', {
		style: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'space-between',
			paddingTop: 22,
			borderTop: `1px solid ${COLORS.border}`,
			fontSize: 18,
			color: COLORS.muted,
		},
		children: [
			el('div', {
				style: { display: 'flex', color: COLORS.dim, letterSpacing: 0.36 },
				children: 'ii4ki 1.0.0 #astro MIT',
			}),
			el('div', {
				style: { display: 'flex', color: COLORS.muted },
				children: 'github · rss · email',
			}),
		],
	});

	// Foreground content stack — wraps strips + content so it sits above scanlines/vignette.
	const foreground = el('div', {
		style: {
			position: 'absolute',
			top: 48,
			left: 88,
			right: 88,
			bottom: 48,
			display: 'flex',
			flexDirection: 'column',
		},
		children: [topStrip, content, bottomStrip],
	});

	return el('div', {
		style: {
			width: 1200,
			height: 630,
			display: 'flex',
			backgroundColor: COLORS.bg,
			color: COLORS.text,
			fontFamily: 'JetBrainsMono',
			position: 'relative',
			overflow: 'hidden',
		},
		children: [scanlines, vignette, foreground],
	});
}

export async function renderOgPng(title: string, description: string): Promise<Buffer> {
	const { regular, bold } = await loadFonts();
	const svg = await satori(template(title, description) as unknown as never, {
		width: 1200,
		height: 630,
		fonts: [
			{ name: 'JetBrainsMono', data: regular, weight: 400, style: 'normal' },
			{ name: 'JetBrainsMono', data: bold, weight: 700, style: 'normal' },
		],
	});
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
	return png;
}
