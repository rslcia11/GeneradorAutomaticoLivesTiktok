/**
 * Servidor estático mínimo para el overlay (sin dependencias).
 *
 * El overlay usa módulos ES: abrir index.html con doble clic (file://)
 * no funciona, el navegador bloquea los imports. Hay que servirlo por HTTP.
 *
 *   npm run overlay                                → http://127.0.0.1:5500
 *   PowerShell: $env:OVERLAY_PORT=5600; npm run overlay  → otro puerto
 *   bash:       OVERLAY_PORT=5600 npm run overlay
 *
 * Solo escucha en 127.0.0.1 (OBS corre en la misma PC).
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../src/overlay/', import.meta.url)));
const HOST = '127.0.0.1';
const PORT = Number(process.env.OVERLAY_PORT) || 5500;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

function resolveFile(urlPath) {

    const file = join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    const inside = relative(ROOT, file);

    /* Bloquea ../ y rutas absolutas: solo archivos dentro de src/overlay. */
    if (inside.startsWith('..') || isAbsolute(inside)) {
        return null;
    }

    return file;
}

createServer(async (request, response) => {

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
    }

    let file = null;

    try {
        file = resolveFile(decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname));
    } catch {
        // URL mal codificada.
    }

    if (!file) {
        response.writeHead(403).end();
        return;
    }

    try {
        const body = await readFile(file);

        response.writeHead(200, {
            'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });

        response.end(request.method === 'HEAD' ? undefined : body);

    } catch {
        response.writeHead(404).end('No encontrado');
    }

}).on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ El puerto ${PORT} está ocupado. Usa otro con la variable OVERLAY_PORT (ver README → Problemas comunes).`);
    } else {
        console.error('❌ No se pudo iniciar el servidor del overlay:', error.message);
    }

    process.exit(1);
}).listen(PORT, HOST, () => {
    console.log(`🔮 Overlay: http://${HOST}:${PORT}/index.html?avatar=animado`);
});
