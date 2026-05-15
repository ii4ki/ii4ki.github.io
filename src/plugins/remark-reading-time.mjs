import getReadingTime from 'reading-time';
import { toString } from 'mdast-util-to-string';

export function remarkReadingTime() {
	return (tree, { data }) => {
		const text = toString(tree);
		const readingTime = getReadingTime(text);
		data.astro.frontmatter.minutesRead = readingTime.text;
		data.astro.frontmatter.words = readingTime.words;
	};
}
