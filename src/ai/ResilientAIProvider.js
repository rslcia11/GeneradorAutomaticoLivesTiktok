export class ResilientAIProvider {
    constructor({
        providers,
        shouldFallback
    } = {}) {
        if (
            !Array.isArray(providers) ||
            providers.length === 0
        ) {
            throw new Error(
                'ResilientAIProvider requiere al menos un provider'
            );
        }

        for (const provider of providers) {
            if (
                !provider ||
                typeof provider.generate !== 'function'
            ) {
                throw new Error(
                    'Todos los providers deben implementar generate()'
                );
            }
        }

        if (
            shouldFallback !== undefined &&
            typeof shouldFallback !== 'function'
        ) {
            throw new Error(
                'shouldFallback debe ser una función'
            );
        }

        this.providers = [...providers];

        this.shouldFallback =
            shouldFallback ??
            this.#defaultShouldFallback;

        this.stats = {
            requests: 0,
            completed: 0,
            failed: 0,
            fallbacks: 0
        };
    }

    async generate(input) {
        this.stats.requests++;

        const attempts = [];

        for (
            let index = 0;
            index < this.providers.length;
            index++
        ) {
            const provider =
                this.providers[index];

            try {
                const result =
                    await provider.generate(input);

                this.stats.completed++;

                return {
                    ...result,

                    metadata: {
                        ...(result?.metadata ?? {}),

                        resilience: {
                            providerIndex: index,
                            fallbackUsed: index > 0,
                            attempts
                        }
                    }
                };

            } catch (error) {
                attempts.push({
                    providerIndex: index,
                    code: error?.code ?? 'UNKNOWN',
                    status: error?.status ?? null
                });

                const hasNextProvider =
                    index <
                    this.providers.length - 1;

                const canFallback =
                    hasNextProvider &&
                    this.shouldFallback(error);

                if (!canFallback) {
                    this.stats.failed++;
                    throw error;
                }

                this.stats.fallbacks++;
            }
        }

        /*
         * En condiciones normales nunca llegaremos aquí,
         * porque el último provider devuelve o lanza error.
         */
        this.stats.failed++;

        const error = new Error(
            'Todos los providers fallaron'
        );

        error.code =
            'AI_PROVIDERS_EXHAUSTED';

        throw error;
    }

    getStats() {
        return {
            ...this.stats,
            providerCount:
                this.providers.length
        };
    }

    #defaultShouldFallback(error) {
        /*
         * Fallos temporales o de capacidad:
         * tiene sentido intentar otro provider/modelo.
         */
        if (
            error?.code === 'GEMINI_TIMEOUT' ||
            error?.code === 'AI_TIMEOUT'
        ) {
            return true;
        }

        if (
            error?.code === 'GEMINI_HTTP_ERROR'
        ) {
            return (
                error.status === 429 ||
                error.status === 500 ||
                error.status === 502 ||
                error.status === 503 ||
                error.status === 504
            );
        }

        /*
         * Errores como 400/401/403/404 no se consideran
         * transitorios por defecto.
         *
         * Así evitamos ocultar errores de configuración,
         * autenticación o modelos inexistentes.
         */
        return false;
    }
}