// A tiny static server for trying the demo on a phone on the same Wi-Fi. No secrets, no uploads, no logging of requests.
// The camera needs HTTPS except on localhost: use an HTTPS tunnel or a self-signed certificate for a real phone test.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const port = Number(process.env.PORT || 8085);

createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root) || !types[extname(file)]) { res.writeHead(404).end('not found'); return; }
  try { res.writeHead(200, { 'content-type': types[extname(file)] }).end(await readFile(file)); }
  catch { res.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`Demo on http://localhost:${port} (nothing is uploaded)`));
