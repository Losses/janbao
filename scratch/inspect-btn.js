import fs from 'fs';

const css = fs.readFileSync('./node_modules/daisyui/daisyui.css', 'utf8');

function searchOccurrences(word) {
	console.log(`=== OCCURRENCES OF ${word} ===`);
	let index = 0;
	let count = 0;
	while ((index = css.indexOf(word, index)) !== -1 && count < 10) {
		const start = Math.max(0, index - 50);
		const end = Math.min(css.length, index + word.length + 150);
		console.log(`Pos ${index}: ...${css.substring(start, end)}...`);
		index += word.length;
		count++;
	}
}

searchOccurrences('.btn-ghost');
searchOccurrences('.btn-link');
