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
            minGiftDiamondsForPriority: 10
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

    addComment(processor, 'Hola');

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

    assert.deepEqual(processed, ['Hola']);
    assert.equal(processor.queueSize, 0);
});


// 2. Procesamiento secuencial
await test('Procesa trabajos secuencialmente', async () => {
    const processor = createProcessor();

    let concurrent = 0;
    let maxConcurrent = 0;
    const processed = [];

    addComment(processor, 'A');
    addComment(processor, 'B');
    addComment(processor, 'C');

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
        ['A', 'B', 'C']
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

    addComment(processor, 'OK');
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
        addComment(processor, 'A');
        addComment(processor, 'B');

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


console.log(
    `\n🎯 ${passed}/15 pruebas de QueueWorker superadas correctamente.`
);