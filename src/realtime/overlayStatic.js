import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Archivos del overlay servidos por HTTP.
 *
 * El overlay usa módulos ES: abrirlo con doble clic (file://) no funciona,
 * el navegador bloquea los imports. Lo sirve el mismo proceso del backend.
 */

const OVERLAY_ROOT = resolve(fileURLToPath(new URL('../overlay/', import.meta.url)));

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg'
};

/*
 * Lo que la página puede cargar y nada más. Si un día se agrega una fuente
 * o un CDN nuevo, se agrega aquí, no se relaja la política.
 *
 * - script 'unsafe-eval' → PixiJS 8 compila shaders con `new Function`;
 *   sin esto el mago animado no arranca (lo detectó la prueba E2E). Los
 *   scripts siguen siendo SOLO del propio origen y nunca inline. Quitarlo
 *   requiere empaquetar `pixi.js/unsafe-eval` (pendiente en STATUS).
 * - img https: → las imágenes de regalos vienen del CDN de TikTok.
 * - connect 'self' → el WebSocket es del mismo origen (ws/wss lo permite);
 *   `data:` porque PixiJS hace fetch de una imagen data: para detectar
 *   capacidades del navegador.
 * - worker/child blob: → PixiJS crea workers en memoria.
 */
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    'img-src \'self\' data: blob: https:',
    "connect-src 'self' data:",
    "media-src 'self' blob:",
    'worker-src blob:',
    'child-src blob:',
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
].join('; ');

const SECURITY_HEADERS = Object.freeze({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store'
});

/*
 * Una ruta legítima del overlay nunca trae `//`, `\` ni `:`. Esas formas
 * sirven para escribir "index.html" de otra manera (`/%2findex.html`,
 * `/.//index.html`, `index.html::$DATA` en Windows) y saltarse la clave.
 */
const SUSPICIOUS_PATH = /\/\/|\\|:/;

/**
 * `{ pathname (decodificado), search }` de una petición, o null si la URL
 * está mal formada o trae una ruta sospechosa.
 */
export function parseRequest(request, host = '127.0.0.1') {
    try {
        const url = new URL(request.url, `http://${request.headers.host ?? host}`);
        const pathname = decodeURIComponent(url.pathname);

        return SUSPICIOUS_PATH.test(pathname) ? null : { pathname, search: url.search };
    } catch {
        return null;
    }
}

/* En Windows (desarrollo) el disco no distingue mayúsculas. */
const comparable = file =>
    process.platform === 'win32' ? file.toLowerCase() : file;

/**
 * La página en sí: lo único que exige clave. Se decide por el ARCHIVO que
 * se serviría, no por cómo se escribió la URL (`/./index.html`, `/INDEX.HTML`).
 */
export function isPageRequest(pathname, root = OVERLAY_ROOT) {
    const file = resolveOverlayFile(pathname, root);

    return file !== null &&
        comparable(file.replace(/[\\/.]+$/, '')) === comparable(join(root, 'index.html'));
}

/** Ruta de URL → archivo dentro de src/overlay, o null si se sale de ahí. */
export function resolveOverlayFile(pathname, root = OVERLAY_ROOT) {

    const file = join(root, pathname === '/' ? 'index.html' : pathname);
    const inside = relative(root, file);

    /* Bloquea ../ y rutas absolutas: solo archivos dentro del overlay. */
    if (inside.startsWith('..') || isAbsolute(inside)) {
        return null;
    }

    return file;
}

/**
 * Responde con un archivo del overlay. Devuelve siempre; el que llama ya
 * decidió que la petición es un GET/HEAD legítimo.
 */
export async function serveOverlayFile(request, response, pathname, { root = OVERLAY_ROOT } = {}) {

    const file = resolveOverlayFile(pathname, root);

    if (!file) {
        response.writeHead(403).end();
        return;
    }

    let body;

    try {
        body = await readFile(file);
    } catch {
        response.writeHead(404).end('No encontrado');
        return;
    }

    const extension = extname(file).toLowerCase();

    const headers = {
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        ...(extension === '.html' ? SECURITY_HEADERS : { 'Cache-Control': 'no-cache' })
    };

    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
}
