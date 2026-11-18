import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

export async function serveStaticSite(req: IncomingMessage, res: ServerResponse, directory: string) {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404); res.end('Not found'); return
    }
    const root = await realpath(directory)
    const file = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`))
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404); res.end('Not found'); return
    }
    const extension = extname(file)
    res.writeHead(200, {
      'Content-Type': types[extension] ?? 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    })
    if (req.method === 'HEAD') { res.end(); return }
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const status = error instanceof URIError ? 400 : code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 500
    res.writeHead(status); res.end(status === 500 ? 'Unable to serve website' : 'Not found')
  }
}
