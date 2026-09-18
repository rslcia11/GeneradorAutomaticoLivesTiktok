import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
    BASE_POSE,
    POSE_FILES,
    PoseBlender,
    selectPose
} from './overlay/animated/poses.js';

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;

    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

const closeTo = (actual, expected, epsilon = 1e-6) =>
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

/* Color final de un píxel si cada pose pinta su propio "color" (1 canal). */
function composite(blender, colors) {
    let color = 0;

    for (const layer of blender.stack) {
        color = color * (1 - layer.alpha) + colors[layer.key] * layer.alpha;
    }

    return color;
}


// 1. selectPose
test('selectPose: cada intención tiene su pose al hablar', () => {
    assert.equal(selectPose({ state: 'speaking', intent: 'tarot_reading' }), 'tarot');
    assert.equal(selectPose({ state: 'speaking', intent: 'invite_share' }), 'invite');
    assert.equal(selectPose({ state: 'speaking', intent: 'comment' }, () => 0), 'comment');
});

test('selectPose: comentar alterna entre sus tres variantes', () => {
    assert.equal(selectPose({ state: 'speaking', intent: 'comment' }, () => 0), 'comment');
    assert.equal(selectPose({ state: 'speaking', intent: 'comment' }, () => 0.5), 'comment-2');
    assert.equal(selectPose({ state: 'speaking', intent: 'comment' }, () => 0.99), 'comment-3');
});

test('selectPose: escuchar y reaccionar tienen su propia pose', () => {
    assert.equal(selectPose({ state: 'listening' }), 'listening');
    assert.equal(selectPose({ state: 'reacting' }), 'react');
});

test('selectPose: agradecer alterna entre sus dos variantes', () => {
    assert.equal(selectPose({ state: 'speaking', intent: 'thanks' }, () => 0), 'thanks-1');
    assert.equal(selectPose({ state: 'speaking', intent: 'thanks' }, () => 0.99), 'thanks-2');
    assert.equal(selectPose({ state: 'speaking', intent: 'thanks' }, () => 1), 'thanks-2');
});

test('selectPose: intención desconocida o ausente → comentario', () => {
    assert.equal(selectPose({ state: 'speaking', intent: 'otra' }, () => 0), 'comment');
    assert.equal(selectPose({ state: 'speaking' }, () => 0), 'comment');
});

test('selectPose: pensando tiene pose; el reposo usa la base aunque haya intención', () => {
    assert.equal(selectPose({ state: 'thinking', intent: 'thanks' }), 'thinking');
    assert.equal(selectPose({ state: 'idle', intent: 'tarot_reading' }), BASE_POSE);
});

test('toda pose seleccionable tiene archivo y el archivo existe', () => {
    const selectable = new Set([
        'thinking', 'tarot', 'comment', 'comment-2', 'comment-3',
        'thanks-1', 'thanks-2', 'invite', 'listening', 'react'
    ]);

    assert.deepEqual(new Set(Object.keys(POSE_FILES)), selectable);

    for (const file of Object.values(POSE_FILES)) {
        assert.ok(existsSync(new URL(`./overlay/assets/${file}`, import.meta.url)), file);
    }
});


// 2. PoseBlender
test('PoseBlender: la pose nueva entra encima y al completar descarta las de abajo', () => {
    const blender = new PoseBlender({ fadeS: 0.2 });

    assert.equal(blender.setTarget('tarot'), true);
    assert.deepEqual(blender.order(), ['base', 'tarot']);

    blender.update(0.1);
    closeTo(blender.stack.at(-1).alpha, 0.5);

    blender.update(0.1);
    assert.deepEqual(blender.order(), ['tarot']);
    assert.equal(blender.alphaOf('tarot'), 1);
    assert.equal(blender.alphaOf('base'), 0);
});

test('PoseBlender: pedir la pose actual no reinicia nada', () => {
    const blender = new PoseBlender();

    assert.equal(blender.setTarget('base'), false);
    assert.deepEqual(blender.order(), ['base']);
});

test('PoseBlender: nunca se ve el fondo (la capa de abajo siempre es opaca)', () => {
    const blender = new PoseBlender({ fadeS: 0.3 });
    const keys = ['tarot', 'base', 'invite', 'tarot', 'comment', 'base'];

    for (let step = 0; step < 60; step++) {
        if (step % 4 === 0) {
            blender.setTarget(keys[(step / 4) % keys.length]);
        }

        blender.update(0.05);

        assert.equal(blender.stack[0].alpha, 1, `paso ${step}`);
    }
});

test('PoseBlender: volver a una pose a medio fundir no produce salto visual', () => {
    const colors = { base: 0, tarot: 100, invite: 40 };
    const blender = new PoseBlender({ fadeS: 1 });

    blender.setTarget('tarot');
    blender.update(0.4);

    const before = composite(blender, colors);

    blender.setTarget('base');

    closeTo(composite(blender, colors), before);
    assert.equal(blender.stack[0].alpha, 1);

    /* Tres capas a la vez: salto acotado (< 5 % del rango de color). */
    blender.setTarget('invite');
    blender.update(0.3);

    const middle = composite(blender, colors);

    blender.setTarget('tarot');

    assert.ok(Math.abs(composite(blender, colors) - middle) < 5);
});

test('PoseBlender: visibilityOf suma 1 entre todas las poses de la pila', () => {
    const blender = new PoseBlender({ fadeS: 1 });

    blender.setTarget('tarot');
    blender.update(0.3);
    blender.setTarget('invite');
    blender.update(0.5);

    const sum = ['base', 'tarot', 'invite'].reduce((total, key) => total + blender.visibilityOf(key), 0);

    closeTo(sum, 1);
    closeTo(blender.visibilityOf('invite'), 0.5);
    assert.equal(blender.visibilityOf('comment'), 0);
});

test('PoseBlender: alphaOf aplica easing suave (0 y 1 exactos en los extremos)', () => {
    const blender = new PoseBlender({ fadeS: 1 });

    blender.setTarget('invite');
    assert.equal(blender.alphaOf('invite'), 0);

    blender.update(0.25);
    assert.ok(blender.alphaOf('invite') < 0.25);

    blender.update(0.25);
    closeTo(blender.alphaOf('invite'), 0.5);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de poses superadas correctamente.`
);
