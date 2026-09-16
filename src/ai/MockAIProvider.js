export class MockAIProvider {

    constructor({
        delayMs = 100,
        mode = 'success'
    } = {}) {

        if (
            !Number.isInteger(delayMs) ||
            delayMs < 0
        ) {
            throw new Error(
                'delayMs debe ser un entero mayor o igual que 0'
            );
        }

        const validModes = [
            'success',
            'error',
            'empty',
            'invalid'
        ];

        if (!validModes.includes(mode)) {
            throw new Error(
                `Modo MOCK no válido: ${mode}`
            );
        }

        this.delayMs = delayMs;
        this.mode = mode;

        this.calls = 0;
    }

    async generate(input) {

        this.calls++;

        if (this.delayMs > 0) {
            await this.#sleep(this.delayMs);
        }

        switch (this.mode) {

            case 'error':
                throw new Error(
                    'Error simulado del proveedor de IA'
                );

            case 'empty':
                return {
                    text: '   '
                };

            case 'invalid':
                return null;

            case 'success':
            default:
                return this.#generateSuccess(input);
        }
    }

    getStats() {
        return {
            calls: this.calls,
            mode: this.mode,
            delayMs: this.delayMs
        };
    }

    #generateSuccess(input) {

        const event = input?.event;

        if (event?.type === 'comment') {

            const username =
                event.user?.username ??
                'usuario';

            const content =
                event.content ??
                '';

            return {
                text:
                    `Respuesta simulada para @${username}: ${content}`,

                metadata: {
                    provider: 'mock',
                    eventType: 'comment'
                }
            };
        }

        if (event?.type === 'gift') {

            return {
                text:
                    'Gracias por el regalo.',

                metadata: {
                    provider: 'mock',
                    eventType: 'gift'
                }
            };
        }

        return {
            text:
                `Evento ${event?.type ?? 'unknown'} procesado.`,

            metadata: {
                provider: 'mock',
                eventType:
                    event?.type ??
                    'unknown'
            }
        };
    }

    #sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
}