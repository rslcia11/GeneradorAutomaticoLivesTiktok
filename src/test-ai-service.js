import assert from 'node:assert/strict';

import { AIService } from './ai/AIService.js';
import { MockAIProvider } from './ai/MockAIProvider.js';

let passed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}


// 1. Respuesta correcta para comentario
await test('Comentario → respuesta normalizada', async () => {
    const provider = new MockAIProvider({
        delayMs: 0
    });

    const service = new AIService({
        provider,
        timeoutMs: 1000
    });

    const result = await service.generateResponse({
        event: {
            type: 'comment',
            user: {
                id: '123',
                username: 'wilson',
                nickname: 'Wilson'
            },
            content: 'Hola'
        }
    });

    assert.equal(
        result.text,
        'Respuesta simulada para @wilson: Hola'
    );

    assert.equal(
        result.metadata.provider,
        'mock'
    );
});


// 2. Gift
await test('Gift → respuesta del provider', async () => {
    const provider = new MockAIProvider({
        delayMs: 0
    });

    const service = new AIService({
        provider
    });

    const result = await service.generateResponse({
        event: {
            type: 'gift',
            user: {
                username: 'usuario'
            },
            gift: {
                giftName: 'Rose',
                diamondCount: 1
            }
        }
    });

    assert.equal(
        result.text,
        'Gracias por el regalo.'
    );

    assert.equal(
        result.metadata.eventType,
        'gift'
    );
});


// 3. Evento genérico
await test('Evento genérico → respuesta válida', async () => {
    const provider = new MockAIProvider({
        delayMs: 0
    });

    const service = new AIService({
        provider
    });

    const result = await service.generateResponse({
        event: {
            type: 'follow'
        }
    });

    assert.equal(
        result.text,
        'Evento follow procesado.'
    );
});


// 4. Contexto llega al provider
await test('AIService entrega context al provider', async () => {
    let receivedInput = null;

    const provider = {
        async generate(input) {
            receivedInput = input;

            return {
                text: 'OK'
            };
        }
    };

    const service = new AIService({
        provider
    });

    const context = {
        creatorId: 'creator-1',
        language: 'es'
    };

    await service.generateResponse({
        event: {
            type: 'comment',
            content: 'Pregunta'
        },
        context
    });

    assert.deepEqual(
        receivedInput.context,
        context
    );
});


// 5. Solo expone campos normalizados del usuario
await test('Normaliza entrada del usuario', async () => {
    let receivedInput = null;

    const provider = {
        async generate(input) {
            receivedInput = input;

            return {
                text: 'OK'
            };
        }
    };

    const service = new AIService({
        provider
    });

    await service.generateResponse({
        event: {
            type: 'comment',

            user: {
                id: '1',
                username: 'user1',
                nickname: 'User 1',
                campoInterno: 'NO DEBE PASAR'
            },

            content: 'Hola',

            campoExtra: 'NO DEBE PASAR'
        }
    });

    assert.deepEqual(
        receivedInput.event.user,
        {
            id: '1',
            username: 'user1',
            nickname: 'User 1'
        }
    );

    assert.equal(
        receivedInput.event.campoExtra,
        undefined
    );
});


// 6. Trim de respuesta
await test('Elimina espacios de la respuesta', async () => {
    const provider = {
        async generate() {
            return {
                text: '   Respuesta limpia   '
            };
        }
    };

    const service = new AIService({
        provider
    });

    const result = await service.generateResponse({
        event: {
            type: 'comment',
            content: 'Hola'
        }
    });

    assert.equal(
        result.text,
        'Respuesta limpia'
    );
});


// 7. Metadata ausente se normaliza
await test('Metadata ausente → objeto vacío', async () => {
    const provider = {
        async generate() {
            return {
                text: 'Respuesta'
            };
        }
    };

    const service = new AIService({
        provider
    });

    const result = await service.generateResponse({
        event: {
            type: 'comment',
            content: 'Hola'
        }
    });

    assert.deepEqual(
        result.metadata,
        {}
    );
});


// 8. Error del proveedor se propaga
await test('Error del provider → fallo controlado', async () => {
    const provider = new MockAIProvider({
        delayMs: 0,
        mode: 'error'
    });

    const service = new AIService({
        provider
    });

    await assert.rejects(
        () => service.generateResponse({
            event: {
                type: 'comment',
                content: 'Hola'
            }
        }),
        /Error simulado/
    );

    const stats = service.getStats();

    assert.equal(stats.requests, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.completed, 0);
});


// 9. Respuesta vacía
await test('Respuesta vacía → error', async () => {
    const provider = new MockAIProvider({
        delayMs: 0,
        mode: 'empty'
    });

    const service = new AIService({
        provider
    });

    await assert.rejects(
        () => service.generateResponse({
            event: {
                type: 'comment',
                content: 'Hola'
            }
        }),
        /respuesta vacía/
    );
});


// 10. Respuesta inválida
await test('Respuesta inválida → error', async () => {
    const provider = new MockAIProvider({
        delayMs: 0,
        mode: 'invalid'
    });

    const service = new AIService({
        provider
    });

    await assert.rejects(
        () => service.generateResponse({
            event: {
                type: 'comment',
                content: 'Hola'
            }
        }),
        /respuesta inválida/
    );
});


// 11. Timeout
await test('Provider lento → AI_TIMEOUT', async () => {
    const provider = new MockAIProvider({
        delayMs: 100
    });

    const service = new AIService({
        provider,
        timeoutMs: 20
    });

    await assert.rejects(
        async () => {
            try {
                await service.generateResponse({
                    event: {
                        type: 'comment',
                        content: 'Hola'
                    }
                });
            } catch (error) {
                assert.equal(
                    error.code,
                    'AI_TIMEOUT'
                );

                throw error;
            }
        },
        /excedió/
    );

    const stats = service.getStats();

    assert.equal(stats.requests, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.timedOut, 1);
});


// 12. Estadísticas de éxito
await test('Estadísticas de éxito correctas', async () => {
    const provider = new MockAIProvider({
        delayMs: 0
    });

    const service = new AIService({
        provider
    });

    await service.generateResponse({
        event: {
            type: 'comment',
            content: 'A'
        }
    });

    await service.generateResponse({
        event: {
            type: 'comment',
            content: 'B'
        }
    });

    const stats = service.getStats();

    assert.equal(stats.requests, 2);
    assert.equal(stats.completed, 2);
    assert.equal(stats.failed, 0);
    assert.equal(stats.timedOut, 0);

    assert.equal(
        provider.getStats().calls,
        2
    );
});


// 13. Evento inválido
await test('Evento inválido → error antes del provider', async () => {
    const provider = new MockAIProvider({
        delayMs: 0
    });

    const service = new AIService({
        provider
    });

    await assert.rejects(
        () => service.generateResponse({
            event: null
        }),
        /evento válido/
    );

    assert.equal(
        provider.getStats().calls,
        0
    );
});


// 14. Provider inválido
await test('Constructor exige provider.generate()', async () => {
    assert.throws(
        () => new AIService({
            provider: {}
        }),
        /provider/
    );
});


// 15. timeoutMs inválido
await test('Constructor valida timeoutMs', async () => {
    const provider = new MockAIProvider({
        delayMs: 0
    });

    assert.throws(
        () => new AIService({
            provider,
            timeoutMs: 0
        }),
        /timeoutMs/
    );
});


console.log(
    `\n🎯 ${passed}/15 pruebas de AIService superadas correctamente.`
);