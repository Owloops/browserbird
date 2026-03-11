import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWriteStream, createReadStream, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';

const PORT = 3001;
const UPLOAD_DIR = '/tmp/uploads';
const MAX_SIZE = 50 * 1024 * 1024;

mkdirSync(UPLOAD_DIR, { recursive: true });

function json(res: ServerResponse, status: number, body: Record<string, string>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handleUpload(req: IncomingMessage, res: ServerResponse): void {
  const filename = req.headers['x-filename'] as string | undefined;
  if (!filename || /[/\\]/.test(filename)) {
    json(res, 400, { error: 'missing or invalid x-filename header' });
    return;
  }

  const dest = join(UPLOAD_DIR, filename);
  const stream = createWriteStream(dest);
  let size = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_SIZE) {
      aborted = true;
      stream.destroy();
      try { unlinkSync(dest); } catch {}
      json(res, 413, { error: 'file too large' });
      req.destroy();
      return;
    }
    stream.write(chunk);
  });

  req.on('end', () => {
    if (aborted) return;
    stream.end(() => json(res, 200, { path: dest }));
  });

  req.on('error', () => {
    stream.destroy();
    try { unlinkSync(dest); } catch {}
    json(res, 500, { error: 'upload failed' });
  });
}

function handleDownload(req: IncomingMessage, res: ServerResponse): void {
  const filename = basename(req.url!.slice(7));
  const filepath = join(UPLOAD_DIR, filename);
  const stream = createReadStream(filepath);
  stream.on('error', () => json(res, 404, { error: 'not found' }));
  stream.on('open', () => {
    res.writeHead(200);
    stream.pipe(res);
  });
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'POST' && req.url === '/upload') {
    handleUpload(req, res);
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/files/')) {
    handleDownload(req, res);
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`file server listening on port ${PORT}`);
});
