'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

function assetPath(root, address) {
  const url = new URL(address);
  if (url.protocol !== 'adofai:' || url.hostname !== 'game' || url.port || url.username || url.password) throw new Error('Invalid game origin');
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (relative.includes('\0') || relative.includes(':')) throw new Error('Invalid asset path');
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Asset outside game directory');
  return file;
}

function register(protocol, net, root) {
  protocol.handle('adofai', async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    try {
      const file = assetPath(root, request.url);
      const response = await net.fetch(pathToFileURL(file).href, { method: request.method });
      const headers = new Headers(response.headers);
      if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error('[adofai] asset load failed:', error.message);
      return new Response('Game asset unavailable', { status: 404 });
    }
  });
}

module.exports = { assetPath, register };
