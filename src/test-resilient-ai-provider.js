import assert from 'node:assert/strict';
import { ResilientAIProvider } from './ai/ResilientAIProvider.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        failed++;
        console.error(`❌ ${name}`);
        console.error(`   ${error.message}`);
    }
}

function successProvider(text = 'OK') {
    return {
        async generate() {
            return {
                text,
                metadata: {
                    provider: 'fake-success'
                }
            };
        }
    };
}

function errorProvider({
    code = 'UNKNOWN',
    status = null,
    message = 'Provider failed'
} = {}) {
    return {
        async generate() {
            const error = new Error(message);
            error.code = code;

            if (status !== null) {
                error.status = status;
            }

            throw error;
        }
    };
}

await test(
    'Provider principal exitoso → no usa fallback',
    async () => {
        let fallbackCalls = 0;

        const provider = new ResilientAIProvider({
            providers: [
                successProvider('principal'),
                {
                    async generate() {
                        fallbackCalls++;
                        return {
                            text: 'fallback',
                            metadata: {}
                        };
                    }
                }
            ]
        });

        const result = await provider.generate({});

        assert.equal(result.text, 'principal');
        assert.equal(fallbackCalls, 0);

        assert.equal(
            result.metadata.resilience.fallbackUsed,
            false
        );

        assert.equal(
            result.metadata.resilience.providerIndex,
            0
        );
    }
);

await test(
    'HTTP 503 → usa siguiente provider',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 503
                }),
                successProvider('fallback')
            ]
        });

        const result = await provider.generate({});

        assert.equal(result.text, 'fallback');

        assert.equal(
            result.metadata.resilience.fallbackUsed,
            true
        );

        assert.equal(
            result.metadata.resilience.providerIndex,
            1
        );
    }
);

await test(
    'HTTP 429 → usa fallback',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 429
                }),
                successProvider('fallback-429')
            ]
        });

        const result = await provider.generate({});

        assert.equal(
            result.text,
            'fallback-429'
        );
    }
);

await test(
    'GEMINI_TIMEOUT → usa fallback',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_TIMEOUT'
                }),
                successProvider('fallback-timeout')
            ]
        });

        const result = await provider.generate({});

        assert.equal(
            result.text,
            'fallback-timeout'
        );
    }
);

await test(
    'AI_TIMEOUT → usa fallback',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'AI_TIMEOUT'
                }),
                successProvider('fallback-ai-timeout')
            ]
        });

        const result = await provider.generate({});

        assert.equal(
            result.text,
            'fallback-ai-timeout'
        );
    }
);

await test(
    'HTTP 500/502/504 → permiten fallback',
    async () => {
        for (const status of [500, 502, 504]) {
            const provider =
                new ResilientAIProvider({
                    providers: [
                        errorProvider({
                            code: 'GEMINI_HTTP_ERROR',
                            status
                        }),
                        successProvider(
                            `fallback-${status}`
                        )
                    ]
                });

            const result =
                await provider.generate({});

            assert.equal(
                result.text,
                `fallback-${status}`
            );
        }
    }
);

await test(
    'HTTP 403 → NO oculta error con fallback',
    async () => {
        let fallbackCalls = 0;

        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 403,
                    message: 'Access denied'
                }),
                {
                    async generate() {
                        fallbackCalls++;

                        return {
                            text: 'no debería ejecutarse',
                            metadata: {}
                        };
                    }
                }
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error =>
                error.code ===
                    'GEMINI_HTTP_ERROR' &&
                error.status === 403
        );

        assert.equal(fallbackCalls, 0);
    }
);

await test(
    'HTTP 404 → NO usa fallback',
    async () => {
        let fallbackCalls = 0;

        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 404
                }),
                {
                    async generate() {
                        fallbackCalls++;

                        return {
                            text: 'fallback',
                            metadata: {}
                        };
                    }
                }
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error => error.status === 404
        );

        assert.equal(fallbackCalls, 0);
    }
);

await test(
    'Si todos fallan → propaga error del último provider',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 503
                }),
                errorProvider({
                    code: 'GEMINI_TIMEOUT',
                    message: 'Fallback timeout'
                })
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error =>
                error.code ===
                'GEMINI_TIMEOUT'
        );
    }
);

await test(
    'Metadata registra intento fallido anterior',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 503
                }),
                successProvider('recuperado')
            ]
        });

        const result = await provider.generate({});

        const attempts =
            result.metadata.resilience.attempts;

        assert.equal(attempts.length, 1);

        assert.deepEqual(
            attempts[0],
            {
                providerIndex: 0,
                code: 'GEMINI_HTTP_ERROR',
                status: 503,
                message: 'Provider failed',
                retryAfterMs: null
            }
        );
    }
);

await test(
    'Metadata original del provider se conserva',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                {
                    async generate() {
                        return {
                            text: 'respuesta',
                            metadata: {
                                provider: 'gemini',
                                model: 'test-model',
                                finishReason: 'STOP'
                            }
                        };
                    }
                }
            ]
        });

        const result = await provider.generate({});

        assert.equal(
            result.metadata.provider,
            'gemini'
        );

        assert.equal(
            result.metadata.model,
            'test-model'
        );

        assert.equal(
            result.metadata.finishReason,
            'STOP'
        );
    }
);

await test(
    'Estadísticas sin fallback son correctas',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                successProvider()
            ]
        });

        await provider.generate({});

        assert.deepEqual(
            provider.getStats(),
            {
                requests: 1,
                completed: 1,
                failed: 0,
                fallbacks: 0,
                providerCount: 1
            }
        );
    }
);

await test(
    'Estadísticas contabilizan fallback',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({
                    code: 'GEMINI_HTTP_ERROR',
                    status: 503
                }),
                successProvider()
            ]
        });

        await provider.generate({});

        const stats = provider.getStats();

        assert.equal(stats.requests, 1);
        assert.equal(stats.completed, 1);
        assert.equal(stats.failed, 0);
        assert.equal(stats.fallbacks, 1);
    }
);

await test(
    'Constructor exige providers',
    async () => {
        assert.throws(
            () =>
                new ResilientAIProvider({
                    providers: []
                }),
            /al menos un provider/
        );
    }
);

await test(
    'Constructor valida generate()',
    async () => {
        assert.throws(
            () =>
                new ResilientAIProvider({
                    providers: [{}]
                }),
            /generate/
        );
    }
);

await test(
    'GEMINI_RATE_LIMITED → hace fallback al siguiente provider',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({ code: 'GEMINI_RATE_LIMITED', message: 'Bloqueado' }),
                successProvider('fallback-rate-limited')
            ]
        });

        const result = await provider.generate({});

        assert.equal(result.text, 'fallback-rate-limited');
        assert.equal(result.metadata.resilience.fallbackUsed, true);
    }
);

await test(
    'Ambos providers GEMINI_RATE_LIMITED → lanza AI_ALL_BLOCKED con min retryAfterMs',
    async () => {
        function rateLimitedProvider(retryAfterMs) {
            return {
                async generate() {
                    const error = new Error('Rate limited');
                    error.code = 'GEMINI_RATE_LIMITED';
                    error.retryAfterMs = retryAfterMs;
                    throw error;
                }
            };
        }

        const provider = new ResilientAIProvider({
            providers: [
                rateLimitedProvider(14_000),
                rateLimitedProvider(8_000)
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error => {
                assert.equal(error.code, 'AI_ALL_BLOCKED');
                assert.equal(error.retryAfterMs, 8_000);
                return true;
            }
        );
    }
);

await test(
    'Error mixto (503 + GEMINI_RATE_LIMITED) → NO lanza AI_ALL_BLOCKED',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({ code: 'GEMINI_HTTP_ERROR', status: 503 }),
                errorProvider({ code: 'GEMINI_RATE_LIMITED', message: 'Rate limited' })
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error => {
                assert.notEqual(error.code, 'AI_ALL_BLOCKED');
                return true;
            }
        );
    }
);

await test(
    'Fallback loguea warning con código y proveedor',
    async () => {
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));

        try {
            const provider = new ResilientAIProvider({
                providers: [
                    errorProvider({ code: 'GEMINI_TIMEOUT', message: 'Tardó mucho' }),
                    successProvider('ok')
                ]
            });

            await provider.generate({});

            assert.ok(warnings.length > 0, 'Debe emitir al menos un warning');
            assert.ok(
                warnings[0].includes('Provider 0'),
                `Warning debe mencionar "Provider 0". Recibido: "${warnings[0]}"`
            );
            assert.ok(
                warnings[0].includes('GEMINI_TIMEOUT'),
                `Warning debe incluir el código. Recibido: "${warnings[0]}"`
            );
        } finally {
            console.warn = originalWarn;
        }
    }
);

await test(
    'AI_ALL_BLOCKED contabiliza en stats.failed',
    async () => {
        function rateLimitedProvider() {
            return {
                async generate() {
                    const error = new Error('Rate limited');
                    error.code = 'GEMINI_RATE_LIMITED';
                    error.retryAfterMs = 10_000;
                    throw error;
                }
            };
        }

        const provider = new ResilientAIProvider({
            providers: [
                rateLimitedProvider(),
                rateLimitedProvider()
            ]
        });

        try {
            await provider.generate({});
        } catch { /* esperado */ }

        assert.equal(provider.getStats().failed, 1);
    }
);

console.log(
    '\n────────────────────────────────────────'
);

console.log(
    `🎯 ${passed}/${passed + failed} pruebas de ResilientAIProvider superadas correctamente.`
);

if (failed > 0) {
    process.exitCode = 1;
}