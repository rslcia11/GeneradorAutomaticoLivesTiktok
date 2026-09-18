import assert from 'node:assert/strict';

import {
    EventRuleEngine,
    ACTION,
    PRIORITY
} from './rules/EventRuleEngine.js';

const engine = new EventRuleEngine({
    minGiftDiamondsForPriority: 10
});

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

// 1. Comentario válido
test('Comentario válido → QUEUE', () => {
    const result = engine.evaluate({
        type: 'comment',
        content: 'Hola, esta es una pregunta'
    });

    assert.equal(result.action, ACTION.QUEUE);
    assert.equal(result.priority, PRIORITY.NORMAL);
    assert.equal(result.reason, 'valid_comment');
});

// 2. Comentario vacío
test('Comentario vacío → IGNORE', () => {
    const result = engine.evaluate({
        type: 'comment',
        content: '   '
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'empty_comment');
});

// 3. Like
test('Like → VISUAL', () => {
    const result = engine.evaluate({
        type: 'like',
        like: {
            count: 15,
            total: 1000
        }
    });

    assert.equal(result.action, ACTION.VISUAL);
});

// 4. Room user
test('ROOM_USER → VISUAL', () => {
    const result = engine.evaluate({
        type: 'room_user',
        room: {
            viewers: 50
        }
    });

    assert.equal(result.action, ACTION.VISUAL);
});

// 5. Member
test('MEMBER → IGNORE', () => {
    const result = engine.evaluate({
        type: 'member'
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'high_frequency_event');
});

// 6. Follow
test('FOLLOW → VISUAL', () => {
    const result = engine.evaluate({
        type: 'follow'
    });

    assert.equal(result.action, ACTION.VISUAL);
    assert.equal(result.reason, 'follow');
});

// 7. Share
test('SHARE → VISUAL', () => {
    const result = engine.evaluate({
        type: 'share'
    });

    assert.equal(result.action, ACTION.VISUAL);
    assert.equal(result.reason, 'share');
});

// 8. Regalo normal de bajo valor
test('Gift normal de bajo valor → QUEUE', () => {
    const result = engine.evaluate({
        type: 'gift',

        gift: {
            diamondCount: 1,
            repeatCount: 1,
            combo: false
        }
    });

    assert.equal(result.action, ACTION.QUEUE);
    assert.equal(result.priority, PRIORITY.HIGH);
    assert.equal(result.metadata.totalDiamonds, 1);
});

// 9. Regalo de valor alto
test('Gift >= umbral → PRIORITY', () => {
    const result = engine.evaluate({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 1,
            combo: false
        }
    });

    assert.equal(result.action, ACTION.PRIORITY);
    assert.equal(result.priority, PRIORITY.HIGH);
    assert.equal(result.metadata.totalDiamonds, 30);
});

// 10. Combo todavía en progreso
test('Gift combo en progreso → IGNORE', () => {
    const result = engine.evaluate({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 1,
            combo: true,
            repeatEnd: 0
        }
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'gift_combo_in_progress');
});

// 11. Combo terminado
test('Gift combo terminado → PRIORITY', () => {
    const result = engine.evaluate({
        type: 'gift',

        gift: {
            diamondCount: 30,
            repeatCount: 2,
            combo: true,
            repeatEnd: 1
        }
    });

    assert.equal(result.action, ACTION.PRIORITY);
    assert.equal(result.metadata.totalDiamonds, 60);
});

// 12. Suscripción
test('SUBSCRIPTION → PRIORITY', () => {
    const result = engine.evaluate({
        type: 'subscription'
    });

    assert.equal(result.action, ACTION.PRIORITY);
    assert.equal(result.priority, PRIORITY.HIGH);
});

// 13. Fin del LIVE
test('STREAM_END → VISUAL CRITICAL', () => {
    const result = engine.evaluate({
        type: 'stream_end'
    });

    assert.equal(result.action, ACTION.VISUAL);
    assert.equal(result.priority, PRIORITY.CRITICAL);
});

// 14. Evento desconocido
test('Evento desconocido → IGNORE', () => {
    const result = engine.evaluate({
        type: 'unknown'
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'unsupported_event');
});

// 15. Evento inválido
test('Evento inválido → IGNORE', () => {
    const result = engine.evaluate(null);

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'invalid_event');
});

// 16. Saludo exacto → IGNORE filler_comment
test('Saludo suelto → IGNORE filler_comment', () => {
    const result = engine.evaluate({
        type: 'comment',
        content: 'hola'
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'filler_comment');
});

// 17. Comentario de 1 carácter → IGNORE filler_comment
test('Comentario de 1 carácter → IGNORE filler_comment', () => {
    const result = engine.evaluate({
        type: 'comment',
        content: 'x'
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'filler_comment');
});

// 18. Solo emojis → IGNORE filler_comment
test('Solo emojis → IGNORE filler_comment', () => {
    const result = engine.evaluate({
        type: 'comment',
        content: '🔥🔥🔥'
    });

    assert.equal(result.action, ACTION.IGNORE);
    assert.equal(result.reason, 'filler_comment');
});

// 19. Pregunta de tarot → QUEUE con prioridad HIGH
test('Pregunta con keyword tarot → prioridad HIGH', () => {
    const result = engine.evaluate({
        type: 'comment',
        content: '¿Qué dice el tarot sobre mi trabajo?'
    });

    assert.equal(result.action, ACTION.QUEUE);
    assert.equal(result.priority, PRIORITY.HIGH);
    assert.equal(result.reason, 'valid_comment');
});

// 20. Keyword tarot configurables por instancia
test('Tarot keywords configurables → boost solo con lista custom', () => {
    const customEngine = new EventRuleEngine({
        tarotKeywords: ['unicornio'],
        tarotBoostPriority: PRIORITY.HIGH
    });

    const noBoost = customEngine.evaluate({
        type: 'comment',
        content: 'Pregunta sobre tarot'   // 'tarot' no está en keywords custom
    });

    assert.equal(noBoost.priority, PRIORITY.NORMAL);

    const boosted = customEngine.evaluate({
        type: 'comment',
        content: 'Hay un unicornio en mi carta'
    });

    assert.equal(boosted.priority, PRIORITY.HIGH);
});


console.log(
    `\n🎯 ${passed}/20 pruebas superadas correctamente.`
);