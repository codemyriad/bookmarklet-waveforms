const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const routes = new Map([
	['/', ['text/html; charset=utf-8', path.join(root, 'site', 'index.html')]],
	['/install.js', ['text/javascript; charset=utf-8', path.join(root, 'site', 'install.js')]],
	['/bookmarklet-loader.js', ['text/javascript; charset=utf-8', path.join(root, 'bookmarklet-loader.js')]],
])

const callPage = `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8"><title>Talk fixture</title></head>
	<body>
		<main id="app-content-vue"></main>
		<script nonce="bookmarklet-test">document.documentElement.dataset.fixtureReady = 'true'</script>
	</body>
</html>`

const server = http.createServer((request, response) => {
	const url = new URL(request.url, 'http://127.0.0.1:4173')
	response.setHeader('X-Content-Type-Options', 'nosniff')
	if (url.pathname === '/status') {
		response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
		response.end('ok')
		return
	}
	if (url.pathname === '/call/test') {
		response.writeHead(200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Security-Policy': "default-src 'none'; script-src 'nonce-bookmarklet-test' 'strict-dynamic'; style-src 'unsafe-inline'; media-src blob:; img-src data:; connect-src 'self'",
		})
		response.end(callPage)
		return
	}
	const route = routes.get(url.pathname)
	if (!route) {
		response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
		response.end('not found')
		return
	}
	response.writeHead(200, { 'Content-Type': route[0] })
	fs.createReadStream(route[1]).pipe(response)
})

server.listen(4173, '127.0.0.1')

function close() {
	server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
