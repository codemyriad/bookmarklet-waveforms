const fs = require('node:fs')
const path = require('node:path')
const { minify } = require('terser')

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
	// A bookmark executes as a URL, so the browser percent-decodes its source
	// before parsing it. Leaving operators such as `%360` unescaped can turn
	// valid JavaScript into `60` and fail with "Unexpected number". Encode the
	// complete payload once; the javascript: URL machinery decodes it once.
	const output = `javascript:${encodeURIComponent(result.code)}\n`

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
