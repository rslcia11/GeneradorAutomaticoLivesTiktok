import assert from 'node:assert/strict';

import { EventProcessor } from './events/EventProcessor.js';
import { EventRuleEngine, ACTION } from './rules/EventRuleEngine.js';
import { PriorityQueue } from './rules/PriorityQueue.js';

let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

function createProcessor({
    maxSize = 10,
    minGiftDiamondsForPriority = 10,
    onVisualEvent = null
} = {}) {
    return new EventProcessor({
        ruleEngine: new EventRuleEngine({
            minGiftDiamondsForPriority
        }),

        queue: new PriorityQueue({
            maxSize
        }),

        onVisualEvent
    });
}

// 1. Comentario válido entra a cola
test('Comentario válido → QUEUE', () => {
    const processor = createProcessor();

    const result = processor.process({
        type: 'comment',
        content: 'Primera pregunta'
    });

    assert.equal(result.decision.action, ACTION.QUEUE);
    assert.equal(result.queued, true);
    assert.equal(processor.queueSize, 1);
});

// 2. Comentario vacío se ignora
test('Comentario vacío → no entra a cola', () => {
    const processor = createProcessor();

    const result = processor.process({
        type: 'comment',
        content: '   '
    });

    assert.equal(result.decision.action, ACTION.IGNORE);
    assert.equal(result.queued, false);
    assert.equal(processor.queueSize, 0);
});

// 3. Like se envía al callback visual
test('LIKE → callback visual', () => {
    const visualEvents = [];

    const processor = createProcessor({
        onVisualEvent: event => {
            visualEvents.push(event);
        }
    });

    processor.process({
        type: 'like',
        like: {
            total: 100
        }
    });

    assert.equal(visualEvents.length, 1);
    assert.equal(visualEvents[0].type, 'like');
    assert.equal(processor.queueSize, 0);
});

// 4. Room user también es visual
test('ROOM_USER → callback visual', () => {
    const visualEvents = [];

    const processor = createProcessor({
        onVisualEvent: event => {
            visualEvents.push(event);
        }
    });

    processor.process({
        type: 'room_user',
        room: {
            viewers: 25
        }
    });

    assert.equal(visualEvents.length, 1);
    assert.equal(visualEvents[0].type, 'room_user');
});

// 5. Member se ignora
test('MEMBER → IGNORE', () => {
    const processor = createProcessor();

    processor.process({
        type: 'member'
    });

    assert.equal(processor.queueSize, 0);

    const stats = processor.getStats();

    assert.equal(stats.received, 1);
    assert.equal(stats.ignored, 1);
});

// 6. Gift prioritario entra a cola
test('Gift importante → PRIORITY', () => {
    const processor = createProcessor();

    const result = processor.process({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 1,
            combo: false
        }
    });

    assert.equal(
        result.decision.action,
        ACTION.PRIORITY
    );

    assert.equal(result.queued, true);
    assert.equal(processor.queueSize, 1);
});

// 7. Prioridad altera el orden de procesamiento
test('Gift prioritario sale antes que comentario', () => {
    const processor = createProcessor();

    processor.process({
        type: 'comment',
        content: 'Pregunta normal'
    });

    processor.process({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 1,
            combo: false
        }
    });

    const first = processor.next();
    const second = processor.next();

    assert.equal(first.event.type, 'gift');
    assert.equal(second.event.type, 'comment');
});

// 8. FIFO entre comentarios
test('Comentarios mantienen FIFO', () => {
    const processor = createProcessor();

    processor.process({
        type: 'comment',
        content: 'Primero'
    });

    processor.process({
        type: 'comment',
        content: 'Segundo'
    });

    assert.equal(
        processor.next().event.content,
        'Primero'
    );

    assert.equal(
        processor.next().event.content,
        'Segundo'
    );
});

// 9. peek no consume
test('peek() consulta sin consumir', () => {
    const processor = createProcessor();

    processor.process({
        type: 'comment',
        content: 'Mi consulta'
    });

    const item = processor.peek();

    assert.equal(item.event.content, 'Mi consulta');
    assert.equal(processor.queueSize, 1);
});

// 10. clear vacía la cola
test('clear() vacía la cola', () => {
    const processor = createProcessor();

    processor.process({
        type: 'comment',
        content: 'P1'
    });

    processor.process({
        type: 'comment',
        content: 'P2'
    });

    processor.clear();

    assert.equal(processor.queueSize, 0);
    assert.equal(processor.next(), null);
});

// 11. Cola llena rechaza comentario nuevo
test('Cola llena → comentario nuevo descartado', () => {
    const processor = createProcessor({
        maxSize: 2
    });

    processor.process({
        type: 'comment',
        content: 'P1'
    });

    processor.process({
        type: 'comment',
        content: 'P2'
    });

    const result = processor.process({
        type: 'comment',
        content: 'P3'
    });

    assert.equal(result.queued, false);
    assert.equal(processor.queueSize, 2);

    const stats = processor.getStats();

    assert.equal(stats.dropped, 1);
});

// 12. Evento prioritario desplaza comentario
test('Prioridad alta desplaza evento inferior', () => {
    const processor = createProcessor({
        maxSize: 2
    });

    processor.process({
        type: 'comment',
        content: 'P1'
    });

    processor.process({
        type: 'comment',
        content: 'P2'
    });

    const result = processor.process({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 1,
            combo: false
        }
    });

    assert.equal(result.queued, true);
    assert.notEqual(result.dropped, null);
    assert.equal(processor.queueSize, 2);

    const first = processor.next();

    assert.equal(first.event.type, 'gift');
});

// 13. Estadísticas generales
test('Estadísticas se actualizan correctamente', () => {
    const processor = createProcessor({
        onVisualEvent: () => {}
    });

    processor.process({
        type: 'comment',
        content: 'Pregunta'
    });

    processor.process({
        type: 'like'
    });

    processor.process({
        type: 'member'
    });

    processor.process({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 1,
            combo: false
        }
    });

    const stats = processor.getStats();

    assert.equal(stats.received, 4);
    assert.equal(stats.queued, 1);
    assert.equal(stats.priority, 1);
    assert.equal(stats.visual, 1);
    assert.equal(stats.ignored, 1);
    assert.equal(stats.queueSize, 2);
});

// 14. next sobre cola vacía
test('next() sobre cola vacía → null', () => {
    const processor = createProcessor();

    assert.equal(processor.next(), null);
});

// 15. Error visual no rompe procesamiento
test('Error en callback visual no rompe EventProcessor', () => {
    const originalConsoleError = console.error;

    console.error = () => {};

    try {
        const processor = createProcessor({
            onVisualEvent: () => {
                throw new Error('Error visual simulado');
            }
        });

        assert.doesNotThrow(() => {
            processor.process({
                type: 'like'
            });
        });

        const stats = processor.getStats();

        assert.equal(stats.received, 1);
        assert.equal(stats.visual, 1);
    } finally {
        console.error = originalConsoleError;
    }
});

// 16. Mismo usuario → segundo comentario rechazado
test('Mismo usuario → segundo comentario no entra a cola', () => {
    const processor = createProcessor();

    processor.process({
        type: 'comment',
        content: 'Primera pregunta',
        user: { id: 'u1', username: 'alice' }
    });

    const result = processor.process({
        type: 'comment',
        content: 'Segunda pregunta',
        user: { id: 'u1', username: 'alice' }
    });

    assert.equal(result.queued, false);
    assert.equal(result.reason, 'user_already_queued');
    assert.equal(processor.queueSize, 1);

    const stats = processor.getStats();
    assert.equal(stats.userDuplicate, 1);
});


// 17. Usuarios distintos → ambos entran a cola
test('Usuarios distintos → ambos entran a cola', () => {
    const processor = createProcessor();

    processor.process({
        type: 'comment',
        content: 'Primera pregunta',
        user: { id: 'u1', username: 'alice' }
    });

    const result = processor.process({
        type: 'comment',
        content: 'Segunda pregunta',
        user: { id: 'u2', username: 'bob' }
    });

    assert.equal(result.queued, true);
    assert.equal(processor.queueSize, 2);
});

// 18. Comentario encolado devuelve position 1-based
test('Comentario encolado devuelve position ≥ 1', () => {
    const processor = createProcessor();

    const r1 = processor.process({
        type: 'comment',
        content: 'Primera pregunta',
        user: { id: 'u1' }
    });

    const r2 = processor.process({
        type: 'comment',
        content: 'Segunda pregunta',
        user: { id: 'u2' }
    });

    assert.equal(r1.queued, true);
    assert.ok(r1.position >= 1, 'primer comentario debe tener posición ≥ 1');

    assert.equal(r2.queued, true);
    assert.ok(r2.position >= 1, 'segundo comentario debe tener posición ≥ 1');
});


console.log(
    `\n🎯 ${passed}/18 pruebas de EventProcessor superadas correctamente.`
);