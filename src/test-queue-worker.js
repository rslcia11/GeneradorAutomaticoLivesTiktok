import assert from 'node:assert/strict';

import { EventProcessor } from './events/EventProcessor.js';
import { EventRuleEngine } from './rules/EventRuleEngine.js';
import { PriorityQueue } from './rules/PriorityQueue.js';
import { QueueWorker } from './workers/QueueWorker.js';

let passed = 0;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(
    condition,
    {
        timeoutMs = 1000,
        intervalMs = 10
    } = {}
) {
    const startedAt = Date.now();

    while (!condition()) {
        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error('Timeout esperando condición');
        }

        await sleep(intervalMs);
    }
}

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

function createProcessor({
    maxSize = 20
} = {}) {
    return new EventProcessor({
        ruleEngine: new EventRuleEngine({
            minGiftDiamondsForPriority: 10,

            /* Aquí se prueba el worker, no el filtro de preguntas (test-rules). */
            requireQuestion: false
        }),

        queue: new PriorityQueue({
            maxSize
        })
    });
}

function addComment(processor, content) {
    processor.process({
        type: 'comment',
        content
    });
}

function addGift(processor, diamonds = 30) {
    processor.process({
        type: 'gift',

        gift: {
            diamondCount: diamonds,
            repeatCount: 1,
            combo: false
        }
    });
}


// 1. Procesa un elemento
await test('Procesa elemento de la cola', async () => {
    const processor = createProcessor();
    const processed = [];

    addComment(processor, 'Primera pregunta');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            processed.push(queueItem.event.content);
        }
    });

    worker.start();

    await waitUntil(() => processed.length === 1);

    await worker.stop();

    assert.deepEqual(processed, ['Primera pregunta']);
    assert.equal(processor.queueSize, 0);
});


// 2. Procesamiento secuencial
await test('Procesa trabajos secuencialmente', async () => {
    const processor = createProcessor();

    let concurrent = 0;
    let maxConcurrent = 0;
    const processed = [];

    addComment(processor, 'P1');
    addComment(processor, 'P2');
    addComment(processor, 'P3');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            concurrent++;

            maxConcurrent = Math.max(
                maxConcurrent,
                concurrent
            );

            await sleep(20);

            processed.push(queueItem.event.content);

            concurrent--;
        }
    });

    worker.start();

    await waitUntil(() => processed.length === 3);

    await worker.stop();

    assert.equal(maxConcurrent, 1);
    assert.deepEqual(
        processed,
        ['P1', 'P2', 'P3']
    );
});


// 3. Respeta prioridad de la cola
await test('Respeta prioridad antes de consumir', async () => {
    const processor = createProcessor();
    const processed = [];

    addComment(processor, 'Comentario');
    addGift(processor, 30);

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            processed.push(queueItem.event.type);
        }
    });

    worker.start();

    await waitUntil(() => processed.length === 2);

    await worker.stop();

    assert.deepEqual(
        processed,
        ['gift', 'comment']
    );
});


// 4. Handler async
await test('Espera correctamente handler async', async () => {
    const processor = createProcessor();
    let completed = false;

    addComment(processor, 'Async');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async () => {
            await sleep(30);
            completed = true;
        }
    });

    worker.start();

    await waitUntil(() => completed);

    await worker.stop();

    assert.equal(completed, true);
});


// 5. Error no detiene el worker
await test('Un error no detiene trabajos posteriores', async () => {
    const processor = createProcessor();
    const processed = [];
    const errors = [];

    addComment(processor, 'FALLA');
    addComment(processor, 'FUNCIONA');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            const content =
                queueItem.event.content;

            if (content === 'FALLA') {
                throw new Error('Fallo simulado');
            }

            processed.push(content);
        },

        onError: async error => {
            errors.push(error.message);
        }
    });

    worker.start();

    await waitUntil(() => {
        const stats = worker.getStats();

        return (
            stats.failed === 1 &&
            stats.processed === 1
        );
    });

    await worker.stop();

    assert.deepEqual(errors, ['Fallo simulado']);
    assert.deepEqual(processed, ['FUNCIONA']);
});


// 6. Estadísticas
await test('Actualiza estadísticas correctamente', async () => {
    const processor = createProcessor();

    addComment(processor, 'Pr1');
    addComment(processor, 'ERROR');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            if (
                queueItem.event.content === 'ERROR'
            ) {
                throw new Error('Error controlado');
            }
        },

        onError: async () => {}
    });

    worker.start();

    await waitUntil(() => {
        const stats = worker.getStats();

        return (
            stats.processed === 1 &&
            stats.failed === 1
        );
    });

    await worker.stop();

    const stats = worker.getStats();

    assert.equal(stats.processed, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.running, false);
    assert.equal(stats.processing, false);
    assert.equal(stats.queueSize, 0);
});


// 7. start es idempotente
await test('start() no crea dos ciclos', async () => {
    const processor = createProcessor();

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        handler: async () => {}
    });

    const first = worker.start();
    const second = worker.start();

    await worker.stop();

    assert.equal(first, true);
    assert.equal(second, false);
});


// 8. stop espera trabajo actual
await test('stop() espera trabajo en ejecución', async () => {
    const processor = createProcessor();

    let started = false;
    let finished = false;

    addComment(processor, 'Lento');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async () => {
            started = true;

            await sleep(50);

            finished = true;
        }
    });

    worker.start();

    await waitUntil(() => started);

    await worker.stop();

    assert.equal(finished, true);
    assert.equal(
        worker.getStats().processing,
        false
    );
});


// 9. stop impide consumir elementos posteriores
await test('stop() no inicia nuevos trabajos', async () => {
    const processor = createProcessor();

    const processed = [];
    let firstStarted = false;

    addComment(processor, 'Primero');
    addComment(processor, 'Segundo');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            processed.push(
                queueItem.event.content
            );

            if (
                queueItem.event.content ===
                'Primero'
            ) {
                firstStarted = true;
                await sleep(50);
            }
        }
    });

    worker.start();

    await waitUntil(() => firstStarted);

    await worker.stop();

    assert.deepEqual(processed, ['Primero']);
    assert.equal(processor.queueSize, 1);
});


// 10. onResult recibe resultado
await test('onResult recibe respuesta del handler', async () => {
    const processor = createProcessor();

    let receivedResult = null;
    let receivedContent = null;

    addComment(processor, 'Pregunta');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            return {
                text:
                    `Respuesta a ${queueItem.event.content}`
            };
        },

        onResult: async (result, queueItem) => {
            receivedResult = result;
            receivedContent =
                queueItem.event.content;
        }
    });

    worker.start();

    await waitUntil(
        () => receivedResult !== null
    );

    await worker.stop();

    assert.equal(
        receivedResult.text,
        'Respuesta a Pregunta'
    );

    assert.equal(
        receivedContent,
        'Pregunta'
    );
});


// 11. Error en onResult no mata worker
await test('Error en onResult no detiene worker', async () => {
    const processor = createProcessor();

    const originalConsoleError =
        console.error;

    console.error = () => {};

    try {
        addComment(processor, 'Pa');
        addComment(processor, 'Pb');

        const worker = new QueueWorker({
            processor,
            pollIntervalMs: 10,

            handler: async queueItem => {
                return queueItem.event.content;
            },

            onResult: async () => {
                throw new Error(
                    'Error callback'
                );
            }
        });

        worker.start();

        await waitUntil(
            () =>
                worker.getStats().processed === 2
        );

        await worker.stop();

        assert.equal(
            worker.getStats().processed,
            2
        );

    } finally {
        console.error =
            originalConsoleError;
    }
});


// 12. Cola vacía no genera procesamiento
await test('Cola vacía permanece estable', async () => {
    const processor = createProcessor();

    let calls = 0;

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async () => {
            calls++;
        }
    });

    worker.start();

    await sleep(50);

    await worker.stop();

    assert.equal(calls, 0);
    assert.equal(
        worker.getStats().processed,
        0
    );
});


// 13. Puede arrancarse nuevamente después de stop
await test('Puede reiniciarse después de stop', async () => {
    const processor = createProcessor();

    const processed = [];

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async queueItem => {
            processed.push(
                queueItem.event.content
            );
        }
    });

    worker.start();
    await worker.stop();

    addComment(processor, 'Después');

    const restarted = worker.start();

    await waitUntil(
        () => processed.length === 1
    );

    await worker.stop();

    assert.equal(restarted, true);
    assert.deepEqual(
        processed,
        ['Después']
    );
});


// 14. Constructor exige processor
await test('Constructor exige processor', async () => {
    assert.throws(
        () => new QueueWorker({
            handler: async () => {}
        }),
        /processor/
    );
});


// 15. Constructor exige handler válido
await test('Constructor exige handler', async () => {
    const processor = createProcessor();

    assert.throws(
        () => new QueueWorker({
            processor
        }),
        /handler/
    );
});


// 16. AI_ALL_BLOCKED no llama onError ni cuenta como fallo
await test('AI_ALL_BLOCKED → sin onError, establece blockedUntil', async () => {
    const processor = createProcessor();
    let onErrorCalled = false;

    addComment(processor, 'cuota agotada');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async () => {
            const error = new Error('Cuota agotada');
            error.code = 'AI_ALL_BLOCKED';
            error.retryAfterMs = 15_000;
            throw error;
        },

        onError: async () => {
            onErrorCalled = true;
        }
    });

    worker.start();

    await waitUntil(
        () => worker.blockedUntil > 0,
        { timeoutMs: 500 }
    );

    await worker.stop();

    assert.equal(onErrorCalled, false, 'onError no debe llamarse');
    assert.ok(
        worker.blockedUntil > Date.now(),
        'blockedUntil debe estar en el futuro'
    );
    assert.equal(
        worker.drainItemsBefore,
        worker.blockedUntil
    );
    assert.equal(
        worker.getStats().failed,
        0,
        'No debe contar como fallo'
    );
});


// 17. Worker no desencola mientras está bloqueado
await test('No procesa items mientras blockedUntil está en el futuro', async () => {
    const processor = createProcessor();
    let handlerCalls = 0;

    addComment(processor, 'Bloqueado');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        handler: async () => { handlerCalls++; }
    });

    // Bloquear manualmente antes de arrancar
    worker.blockedUntil = Date.now() + 300;

    worker.start();

    await sleep(100);

    assert.equal(handlerCalls, 0, 'Handler no debe llamarse mientras bloqueado');
    assert.equal(processor.queueSize, 1, 'Item debe seguir en cola');

    await worker.stop();
});


// 18. Item más viejo que maxItemAgeMs se descarta silenciosamente
await test('Item antiguo (> maxItemAgeMs) se descarta sin llamar onError', async () => {
    const processor = createProcessor();
    let handlerCalls = 0;
    let onErrorCalled = false;

    // Añadir item con timestamp antiguo para que queuedAt también sea viejo.
    // Usamos un wrapper que sobreescribe queuedAt después de encolar.
    addComment(processor, 'viejo');

    // Hack: el item ya está en la cola — manipulamos queuedAt directamente
    // accediendo a la cola interna para simular un item que lleva 2 minutos esperando.
    const item = processor.peek();
    assert.ok(item, 'peek() debe devolver el item encolado');
    item.queuedAt = Date.now() - 120_000; // 2 minutos de antigüedad

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        maxItemAgeMs: 60_000,

        handler: async () => { handlerCalls++; },
        onError: async () => { onErrorCalled = true; }
    });

    worker.start();

    await waitUntil(
        () => processor.queueSize === 0,
        { timeoutMs: 500 }
    );

    await worker.stop();

    assert.equal(handlerCalls, 0, 'Handler no debe llamarse para item antiguo');
    assert.equal(onErrorCalled, false, 'onError no debe llamarse para item antiguo');
    assert.equal(worker.getStats().failed, 0, 'No debe contar como fallo');
});


// 19. Item con queuedAt durante bloqueo se descarta al reanudar
await test('Item encolado durante bloqueo se descarta cuando el worker reanuda', async () => {
    const processor = createProcessor();
    let handlerCalls = 0;

    addComment(processor, 'durante-bloqueo');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        handler: async () => { handlerCalls++; }
    });

    // Simular: el bloqueo "acaba de terminar" pero el item fue encolado durante él.
    // drainItemsBefore = ahora → cualquier item con queuedAt < ahora será descartado.
    worker.drainItemsBefore = Date.now() + 100;

    worker.start();

    await waitUntil(
        () => processor.queueSize === 0,
        { timeoutMs: 500 }
    );

    await worker.stop();

    assert.equal(handlerCalls, 0, 'Item durante bloqueo no debe procesarse');
});


console.log(
    `\n🎯 ${passed}/19 pruebas de QueueWorker superadas correctamente.`
);