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
                status: 503
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

console.log(
    '\n────────────────────────────────────────'
);

console.log(
    `🎯 ${passed}/${passed + failed} pruebas de ResilientAIProvider superadas correctamente.`
);

if (failed > 0) {
    process.exitCode = 1;
}