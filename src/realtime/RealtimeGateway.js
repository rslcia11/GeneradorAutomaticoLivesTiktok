import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import { isLoopback, keyFromSearch, keyMatches } from './accessKey.js';
import { isPageRequest, parseRequest, serveOverlayFile } from './overlayStatic.js';

/*
 * Un cliente con más de esto pendiente no está leyendo: se le saltan
 * eventos en vez de acumular audio en la RAM del servidor.
 */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

/* Un overlay por cliente, más alguna recarga de OBS. Más que esto es abuso. */
export const MAX_CLIENTS = 8;

/**
 * Un servidor, un puerto: sirve la página del overlay y el WebSocket (`ws`).
 *
 * Escucha en 127.0.0.1. En producción, Caddy pone HTTPS delante; en local,
 * OBS abre http://127.0.0.1:8080/?key=... directamente.
 *
 * Seguridad:
 * - La página y el WebSocket exigen la clave (`?key=`), si hay clave.
 * - El WebSocket se rechaza ANTES del upgrade: sin clave no hay socket.
 * - `Origin`, si viene, debe coincidir con `Host`: otra página web no puede
 *   abrir el socket aunque tenga la URL.
 * - El overlay solo recibe: cualquier mensaje entrante se ignora.
 */
export class RealtimeGateway {

    constructor({
        port = 8080,
        host = '127.0.0.1',

        /* Clave del overlay; null solo se acepta en loopback. */
        accessKey = null,

        /*
         * Estado inicial para cada overlay que se conecta (menú de
         * regalos, últimos donantes...): función que devuelve eventos.
         */
        welcome = null,

        /* Estado para /healthz: función que devuelve un objeto sin secretos. */
        health = null,

        /* Con `info` y `error`, como src/logger.js (o console). */
        log = console
    } = {}) {

        if (!accessKey && !isLoopback(host)) {
            throw new Error(`RealtimeGateway: no se puede escuchar en ${host} sin clave de acceso`);
        }

        this.port = port;
        this.host = host;
        this.accessKey = accessKey;
        this.welcome = welcome;
        this.health = health;
        this.log = log;

        this.server = null;
        this.wss = null;
    }

    /** Puerto real (útil cuando se pide el 0 en pruebas). */
    get address() {
        return this.server?.address() ?? null;
    }

    /** Overlays conectados ahora mismo. */
    get clientCount() {
        return this.wss?.clients.size ?? 0;
    }

    #authorized(search) {
        return this.accessKey === null || keyMatches(keyFromSearch(search), this.accessKey);
    }

    #sameOrigin(request) {

        const origin = request.headers.origin;

        if (!origin) {
            return true;
        }

        try {
            return new URL(origin).host === request.headers.host;
        } catch {
            return false;
        }
    }

    async #handleRequest(request, response) {

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405).end();
            return;
        }

        const url = parseRequest(request, this.host);

        if (!url) {
            response.writeHead(400).end();
            return;
        }

        const { pathname } = url;

        if (pathname === '/healthz') {
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ ok: true, ...this.health?.() }));
            return;
        }

        if (isPageRequest(pathname) && !this.#authorized(url.search)) {
            response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Falta la clave del overlay');
            return;
        }

        await serveOverlayFile(request, response, pathname);
    }

    #handleUpgrade(request, socket, head) {

        const url = parseRequest(request, this.host);

        if (!url) {
            rejectUpgrade(socket, 400);
            return;
        }

        if (url.pathname !== '/ws') {
            rejectUpgrade(socket, 404);
            return;
        }

        if (!this.#sameOrigin(request)) {
            rejectUpgrade(socket, 403);
            return;
        }

        if (!this.#authorized(url.search)) {
            rejectUpgrade(socket, 401);
            return;
        }

        if (this.wss.clients.size >= MAX_CLIENTS) {
            rejectUpgrade(socket, 429);
            return;
        }

        this.wss.handleUpgrade(request, socket, head, client => {
            this.wss.emit('connection', client, request);
        });
    }

    #handleConnection(socket) {

        this.log.info(`🟢 Overlay conectado (${this.wss.clients.size} total)`);

        socket.send(JSON.stringify({
            type: 'system',
            event: 'connected',
            timestamp: Date.now()
        }));

        if (typeof this.welcome === 'function') {
            try {
                for (const event of this.welcome() ?? []) {
                    socket.send(JSON.stringify(event));
                }
            } catch (error) {
                this.log.error('❌ Error enviando el estado inicial:', error.message);
            }
        }

        /* El overlay no habla: no hay manejador de 'message', lo que llegue se descarta. */
        socket.on('close', () => {
            this.log.info(`🔴 Overlay desconectado (${this.wss.clients.size} total)`);
        });

        socket.on('error', error => {
            this.log.error('❌ Error en cliente WebSocket:', error.message);
        });
    }

    /** Resuelve cuando el servidor ya escucha. */
    start() {

        if (this.server) {
            throw new Error('RealtimeGateway ya está iniciado');
        }

        this.wss = new WebSocketServer({
            noServer: true,

            /* El overlay solo recibe; no hay mensajes entrantes legítimos. */
            maxPayload: 1024
        });

        this.wss.on('connection', socket => this.#handleConnection(socket));

        this.server = createServer((request, response) => {
            this.#handleRequest(request, response).catch(error => {
                this.log.error('❌ Error sirviendo el overlay:', error.message);

                if (!response.headersSent) {
                    response.writeHead(500).end();
                }
            });
        });

        this.server.on('upgrade', (request, socket, head) => this.#handleUpgrade(request, socket, head));

        this.server.on('error', error => {
            this.log.error('❌ Error del servidor:', error.message);
        });

        return new Promise((resolve, reject) => {
            this.server.once('error', reject);

            this.server.listen(this.port, this.host, () => {
                this.server.off('error', reject);
                this.log.info(`✅ Overlay y WebSocket escuchando en http://${this.host}:${this.address.port}`);
                resolve();
            });
        });
    }

    broadcast(event) {

        if (!this.wss) {
            return;
        }

        const payload = JSON.stringify(event);

        for (const client of this.wss.clients) {
            if (
                client.readyState === WebSocket.OPEN &&
                client.bufferedAmount <= MAX_BUFFERED_BYTES
            ) {
                client.send(payload);
            }
        }
    }

    async stop() {

        if (!this.server) {
            return;
        }

        for (const client of this.wss.clients) {
            client.close();
        }

        await new Promise(resolve => this.wss.close(resolve));
        await new Promise(resolve => this.server.close(resolve));

        this.wss = null;
        this.server = null;
    }
}

const REASONS = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests'
};

/* Respuesta HTTP cruda: en un upgrade todavía no hay objeto response. */
function rejectUpgrade(socket, status) {
    socket.write(`HTTP/1.1 ${status} ${REASONS[status]}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
}
