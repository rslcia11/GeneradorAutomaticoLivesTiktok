import { WebSocketServer, WebSocket } from 'ws';

/*
 * Un cliente con más de esto pendiente no está leyendo: se le saltan
 * eventos en vez de acumular audio en la RAM del streamer.
 */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

export class RealtimeGateway {

    constructor({
        port = 8080,

        /*
         * Solo esta PC (el overlay de OBS corre en la misma máquina).
         * Sin esto, cualquiera en la red local podría conectarse.
         */
        host = '127.0.0.1'
    } = {}) {
        this.port = port;
        this.host = host;
        this.wss = null;
    }

    start() {
        if (this.wss) {
            throw new Error('RealtimeGateway ya está iniciado');
        }

        this.wss = new WebSocketServer({
            port: this.port,
            host: this.host,

            /* El overlay solo recibe; no hay mensajes entrantes legítimos. */
            maxPayload: 1024
        });

        this.wss.on('listening', () => {
            console.log(
                `✅ WebSocket escuchando en ws://${this.host}:${this.port}`
            );
        });

        this.wss.on('connection', (socket, request) => {
            console.log(
                `🟢 Cliente conectado (${this.wss.clients.size} total)`
            );

            socket.send(JSON.stringify({
                type: 'system',
                event: 'connected',
                timestamp: Date.now()
            }));

            socket.on('close', () => {
                console.log(
                    `🔴 Cliente desconectado (${this.wss.clients.size} total)`
                );
            });

            socket.on('error', error => {
                console.error(
                    '❌ Error en cliente WebSocket:',
                    error.message
                );
            });
        });

        this.wss.on('error', error => {
            console.error(
                '❌ Error del servidor WebSocket:',
                error.message
            );
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
        if (!this.wss) {
            return;
        }

        for (const client of this.wss.clients) {
            client.close();
        }

        await new Promise((resolve, reject) => {
            this.wss.close(error => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });

        this.wss = null;
    }
}