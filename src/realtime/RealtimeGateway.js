import { WebSocketServer, WebSocket } from 'ws';

export class RealtimeGateway {

    constructor({ port = 8080 } = {}) {
        this.port = port;
        this.wss = null;
    }

    start() {
        if (this.wss) {
            throw new Error('RealtimeGateway ya está iniciado');
        }

        this.wss = new WebSocketServer({
            port: this.port
        });

        this.wss.on('listening', () => {
            console.log(
                `✅ WebSocket escuchando en ws://localhost:${this.port}`
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
            if (client.readyState === WebSocket.OPEN) {
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