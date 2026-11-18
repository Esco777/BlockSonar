import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { serveStaticSite } from './dist/server/static-site.js'

test('production website serves assets without exposing files outside the build', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blocksonar-static-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'dist')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<html>BlockSonar</html>')
  await writeFile(join(root, 'assets', 'app-123.js'), 'export const ready = true')
  await writeFile(join(root, '.env'), 'PRIVATE')
  await writeFile(join(directory, 'secret.txt'), 'PRIVATE')
  await symlink(join(directory, 'secret.txt'), join(root, 'leak.txt'))
  const server = createServer((req, res) => { void serveStaticSite(req, res, root) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  const url = `http://127.0.0.1:${server.address().port}`
  const index = await fetch(url)
  assert.equal(index.status, 200)
  assert.equal(index.headers.get('cache-control'), 'no-cache')
  assert.match(await index.text(), /BlockSonar/)
  const asset = await fetch(`${url}/assets/app-123.js`)
  assert.match(asset.headers.get('content-type'), /javascript/)
  assert.match(asset.headers.get('cache-control'), /immutable/)
  assert.equal(await asset.text(), 'export const ready = true')
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  for (const path of ['/.env', '/leak.txt', '/missing.js', '/assets/', '/%2eenv']) {
    const response = await fetch(url + path)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(await response.text(), /PRIVATE/)
  }
  assert.equal((await fetch(`${url}/%ZZ`)).status, 400)
})
