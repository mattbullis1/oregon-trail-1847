/**
 * Dependency-free static file server for local testing.
 * XAMPP serves the same files at http://mother.local:8080/oregon-trail/
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function createStaticServer({ root = process.cwd() } = {}) {
  const rootPath = path.resolve(root);
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('METHOD NOT ALLOWED');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('BAD REQUEST');
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(rootPath, `.${pathname}`);
    if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) {
      res.writeHead(403).end('FORBIDDEN');
      return;
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('NOT FOUND');
      return;
    }
    const target = info.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    let targetInfo;
    try {
      targetInfo = await stat(target);
    } catch {
      res.writeHead(404).end('NOT FOUND');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': targetInfo.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(target).pipe(res);
  });
}

export function startStaticServer({ port = 8099, host = '127.0.0.1', root = process.cwd() } = {}) {
  const server = createStaticServer({ root });
  server.listen(port, host, () => {
    console.log(`Oregon Trail 1847 running at http://${host}:${port}/`);
  });
  return server;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) startStaticServer();
