const fs = require('node:fs')
const path = require('node:path')
const { minify } = require('terser')

function encodeJavascriptUrl(source) {
	// Browsers percent-decode a javascript: URL before parsing it. A literal `%`
	// can therefore consume following hex digits (for example, `%360`), while
	// `#` starts a URL fragment and truncates the program. Terser emits one line,
	// so everything else can remain as compact, readable JavaScript.
	return source
		.replaceAll('%', '%25')
		.replaceAll('#', '%23')
}

async function main() {
	const root = path.join(__dirname, '..')
	const { version } = require(path.join(root, 'package.json'))
	const payloadPath = path.join(root, `talk-waveforms.${version}.js`)
	const outputPath = path.join(root, 'bookmarklet-loader.js')
	const source = fs.readFileSync(payloadPath, 'utf8')
	const result = await minify(source, {
		compress: { passes: 2 },
		mangle: true,
		format: { comments: false },
	})
	if (!result.code) throw new Error('Terser produced an empty bookmarklet')
	const output = `javascript:${encodeJavascriptUrl(result.code)}\n`

	if (process.argv.includes('--check')) {
		if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== output) {
			throw new Error('bookmarklet-loader.js is stale; run npm run build:bookmarklet')
		}
		return
	}

	fs.writeFileSync(outputPath, output)
}

main().catch((error) => {
	console.error(error.message)
	process.exitCode = 1
})
