const fs = require('node:fs')
const path = require('node:path')

// Fills README.template.md with the bits that depend on the rest of the repo
// (bookmark URL, version, size, latest showcase capture) and writes README.md.
// `--check` fails instead of writing when README.md is stale.

const root = path.join(__dirname, '..')
const { version } = require(path.join(root, 'package.json'))
const templatePath = path.join(root, 'README.template.md')
const outputPath = path.join(root, 'README.md')

function latestAsset(prefix) {
	const directory = path.join(root, 'site', 'assets')
	const candidates = fs.readdirSync(directory)
		.filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
	if (!candidates.length) throw new Error(`No ${prefix}*.png in site/assets`)
	return `site/assets/${candidates.at(-1)}`
}

const bookmarklet = fs.readFileSync(path.join(root, 'bookmarklet-loader.js'), 'utf8').trim()
const values = {
	VERSION: version,
	BOOKMARKLET: bookmarklet,
	BOOKMARKLET_SIZE_KB: String(Math.round(Buffer.byteLength(bookmarklet) / 1024)),
	JITSI_SHOWCASE: latestAsset('jitsi-waveforms-showcase.'),
}

const output = fs.readFileSync(templatePath, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
	if (!(key in values)) throw new Error(`Unknown README placeholder ${match}`)
	return values[key]
})

if (process.argv.includes('--check')) {
	if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== output) {
		console.error('README.md is stale; run npm run build:readme')
		process.exitCode = 1
	}
} else {
	fs.writeFileSync(outputPath, output)
}
