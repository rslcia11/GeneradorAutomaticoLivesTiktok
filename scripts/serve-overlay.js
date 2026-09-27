/**
 * Sirve la página del overlay + WebSocket mock para desarrollo.
 *
 * El WS mock envía el catálogo de servicios al conectar, para que el
 * menú lateral aparezca igual que con el backend real.
 *
 *   npm run overlay                                → http://127.0.0.1:5500
 *   PowerShell: $env:OVERLAY_PORT=5600; npm run overlay  → otro puerto
 *   bash:       OVERLAY_PORT=5600 npm run overlay
 *
 * Solo escucha en 127.0.0.1.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

import { parseRequest, serveOverlayFile } from '../src/realtime/overlayStatic.js';
import { DEFAULT_SERVICES } from '../src/rules/serviceCatalog.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.OVERLAY_PORT) || 5500;

const server = createServer(async (request, response) => {

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

});

/* WebSocket mock: envía el catálogo al conectar. */
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
    const send = obj => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    };

    /* Catálogo de servicios visible en el panel lateral. */
    send({
        type: 'service_menu',
        services: DEFAULT_SERVICES.filter(s => s.menu !== false)
    });
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ El puerto ${PORT} está ocupado. Usa otro con la variable OVERLAY_PORT (ver README → Problemas comunes).`);
    } else {
        console.error('❌ No se pudo iniciar el servidor del overlay:', error.message);
    }

    process.exit(1);
}).listen(PORT, HOST, () => {
    console.log(`🔮 Overlay (sin backend): http://${HOST}:${PORT}/index.html?avatar=animado`);
});
