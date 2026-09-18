/**
 * Sirve SOLO la página del overlay, sin backend (sin WebSocket).
 *
 * Ya no hace falta para usar la app: `npm start` sirve el overlay y el
 * WebSocket juntos. Queda para trabajar la página sin backend, por ejemplo
 * en `tools/capture-overlay.mjs`, que reemplaza el WebSocket por uno falso.
 *
 *   npm run overlay                                → http://127.0.0.1:5500
 *   PowerShell: $env:OVERLAY_PORT=5600; npm run overlay  → otro puerto
 *   bash:       OVERLAY_PORT=5600 npm run overlay
 *
 * Solo escucha en 127.0.0.1.
 */

import { createServer } from 'node:http';

import { parseRequest, serveOverlayFile } from '../src/realtime/overlayStatic.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.OVERLAY_PORT) || 5500;

createServer(async (request, response) => {

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
    }

    const url = parseRequest(request, HOST);

    if (!url) {
        response.writeHead(400).end();
        return;
    }

    await serveOverlayFile(request, response, url.pathname);

}).on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ El puerto ${PORT} está ocupado. Usa otro con la variable OVERLAY_PORT (ver README → Problemas comunes).`);
    } else {
        console.error('❌ No se pudo iniciar el servidor del overlay:', error.message);
    }

    process.exit(1);
}).listen(PORT, HOST, () => {
    console.log(`🔮 Overlay (sin backend): http://${HOST}:${PORT}/index.html?avatar=animado`);
});
