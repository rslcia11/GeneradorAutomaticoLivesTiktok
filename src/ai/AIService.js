import { resolveIntent } from './intents.js';

export class AIService {

    constructor({
        provider,
        timeoutMs = 15000
    } = {}) {

        if (
            !provider ||
            typeof provider.generate !== 'function'
        ) {
            throw new Error(
                'AIService requiere un provider con generate()'
            );
        }

        if (
            !Number.isInteger(timeoutMs) ||
            timeoutMs <= 0
        ) {
            throw new Error(
                'timeoutMs debe ser un entero mayor que 0'
            );
        }

        this.provider = provider;
        this.timeoutMs = timeoutMs;

        this.stats = {
            requests: 0,
            completed: 0,
            failed: 0,
            timedOut: 0
        };
    }

    async generateResponse({
        event,
        context = null,

        /*
         * Servicio que desbloqueó el espectador (src/rules/serviceCatalog.js):
         * define el largo y la forma de la respuesta.
         */
        service = null
    } = {}) {

        if (!event || typeof event !== 'object') {
            throw new Error(
                'AIService requiere un evento válido'
            );
        }

        const input = this.#buildInput(
            event,
            context,
            service
        );

        this.stats.requests++;

        try {
            const response =
                await this.#withTimeout(
                    this.provider.generate(input)
                );

            const normalized =
                this.#normalizeResponse(response, event);

            this.stats.completed++;

            return normalized;

        } catch (error) {

            this.stats.failed++;

            if (error?.code === 'AI_TIMEOUT') {
                this.stats.timedOut++;
            }

            throw error;
        }
    }

    getStats() {
        return {
            ...this.stats
        };
    }

    #buildInput(event, context, service) {

        return {
            event: {
                type: event.type ?? null,

                user: event.user
                    ? {
                        id:
                            event.user.id ??
                            null,

                        username:
                            event.user.username ??
                            null,

                        nickname:
                            event.user.nickname ??
                            null
                    }
                    : null,

                content:
                    typeof event.content === 'string'
                        ? event.content
                        : null,

                gift:
                    event.gift ?? null
            },

            service,
            context
        };
    }

    #normalizeResponse(response, event) {

        if (!response || typeof response !== 'object') {
            throw new Error(
                'El provider devolvió una respuesta inválida'
            );
        }

        const text =
            typeof response.text === 'string'
                ? response.text.trim()
                : '';

        if (!text) {
            throw new Error(
                'El provider devolvió una respuesta vacía'
            );
        }

        return {
            text,

            intent:
                resolveIntent(event, response.intent),

            metadata:
                response.metadata &&
                typeof response.metadata === 'object'
                    ? response.metadata
                    : {}
        };
    }

    async #withTimeout(promise) {

        let timeoutId;

        const timeoutPromise =
            new Promise((_, reject) => {

                timeoutId = setTimeout(() => {

                    const error = new Error(
                        `AI request excedió ${this.timeoutMs} ms`
                    );

                    error.code = 'AI_TIMEOUT';

                    reject(error);

                }, this.timeoutMs);
            });

        try {
            return await Promise.race([
                promise,
                timeoutPromise
            ]);

        } finally {
            clearTimeout(timeoutId);
        }
    }
}