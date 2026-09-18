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
                    status: error?.status ?? null,
                    message: error?.message ?? null,
                    retryAfterMs: error?.retryAfterMs ?? null
                });

                const hasNextProvider =
                    index <
                    this.providers.length - 1;

                const canFallback =
                    hasNextProvider &&
                    this.shouldFallback(error);

                if (!canFallback) {
                    const allRateLimited =
                        attempts.length > 0 &&
                        attempts.every(
                            a =>
                                a.code === 'GEMINI_RATE_LIMITED' ||
                                (a.code === 'GEMINI_HTTP_ERROR' &&
                                    a.status === 429)
                        );

                    if (allRateLimited) {
                        const retryAfterMs = Math.min(
                            ...attempts.map(
                                a => a.retryAfterMs ?? 60_000
                            )
                        );

                        const blockedError = new Error(
                            'Todos los proveedores de IA tienen la cuota agotada'
                        );

                        blockedError.code = 'AI_ALL_BLOCKED';
                        blockedError.retryAfterMs = retryAfterMs;

                        this.stats.failed++;

                        throw blockedError;
                    }

                    this.stats.failed++;
                    throw error;
                }

                console.warn(
                    `⚠️ Provider ${index} falló` +
                    ` | code=${error?.code ?? 'UNKNOWN'}` +
                    ` | status=${error?.status ?? '-'}` +
                    ` | ${error?.message ?? ''}` +
                    ` | usando provider ${index + 1}...`
                );

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
        if (error?.code === 'GEMINI_RATE_LIMITED') {
            return true;
        }

        if (
            error?.code === 'GEMINI_TIMEOUT' ||
            error?.code === 'AI_TIMEOUT'
        ) {
            return true;
        }

        /*
         * JSON cortado o mal formado: otro modelo puede
         * responder bien la misma petición.
         */
        if (
            error?.code === 'GEMINI_INVALID_RESPONSE'
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