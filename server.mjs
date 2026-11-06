// server.mjs — Servidor HTTP de Produção / Staging para Docker & NAS
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleSlidoApiRequest } from './src/lib/slido-server.mjs';

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function serveStaticFile(req, res) {
  const rawUrl = (req.url || '/').split('?')[0];
  let safePath = path.normalize(decodeURIComponent(rawUrl)).replace(/^(\.\.[/\\])+/, '');
  let targetPath = path.join(DIST_DIR, safePath);

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(targetPath, 'index.html');
  } else if (!path.extname(targetPath) && fs.existsSync( path.join(targetPath, 'index.html'))) {
    targetPath = path.join(targetPath, 'index.html');
  } else if (!fs.existsSync(targetPath) && fs.existsSync(`${targetPath}.html`)) {
    targetPath = `${targetPath}.html`;
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('404 — Página não encontrada');
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  if (ext === '.html' || ext === '.csv') {
    res.setHeader('Cache-Control', 'no-cache');
  } else if (rawUrl.startsWith('/_astro/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  fs.createReadStream(targetPath).pipe(res);
}

const server = http.createServer((req, res) => {
  handleSlidoApiRequest(req, res, () => {
    serveStaticFile(req, res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `🚀 [SlidoFNAC ${process.env.APP_ENV || 'production'}] Servidor ativo em http://${HOST}:${PORT}`
  );
});
