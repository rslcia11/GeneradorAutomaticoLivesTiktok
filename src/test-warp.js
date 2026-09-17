import assert from 'node:assert/strict';

import {
    applyRig,
    createRig,
    ellipseWeight,
    pinStrength,
    weightRigValue
} from './overlay/animated/warp.js';

import { DEFORMERS, PINS, TEXTURE_SIZE } from './overlay/animated/wizardRig.js';
import { SpeechLevel } from './overlay/animated/speech.js';

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

/* Malla regular como la de PixiJS PlaneGeometry. */
function createGrid(width, height, columns, rows) {
    const base = new Float32Array(columns * rows * 2);

    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const i = (row * columns + column) * 2;
            base[i] = (column / (columns - 1)) * width;
            base[i + 1] = (row / (rows - 1)) * height;
        }
    }

    return base;
}

const closeTo = (actual, expected, epsilon = 1e-4) =>
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);


// 1. Falloff
test('ellipseWeight: 1 en el centro, 0 en el borde y fuera', () => {
    const area = { cx: 50, cy: 50, rx: 10, ry: 20 };

    assert.equal(ellipseWeight(50, 50, area), 1);
    assert.equal(ellipseWeight(60, 50, area), 0);
    assert.equal(ellipseWeight(50, 71, area), 0);
    assert.ok(ellipseWeight(55, 50, area) > 0);
});


// 2. Pins
test('pinStrength: elipse inmóvil por dentro, libre lejos', () => {
    const pins = [{ cx: 0, cy: 0, rx: 10, ry: 10, soft: 0.5 }];

    assert.equal(pinStrength(0, 0, pins), 1);
    assert.equal(pinStrength(10, 0, pins), 1);
    assert.equal(pinStrength(30, 0, pins), 0);
    assert.ok(pinStrength(12, 0, pins) > 0 && pinStrength(12, 0, pins) < 1);
});

test('pinStrength: franja inferior (mesa)', () => {
    const pins = [{ belowY: 100, soft: 10 }];

    assert.equal(pinStrength(0, 50, pins), 0);
    assert.equal(pinStrength(0, 150, pins), 1);
});


// 3. Sin valores no hay deformación
test('applyRig sin valores deja la malla intacta', () => {
    const base = createGrid(100, 100, 11, 11);
    const rig = createRig({
        base,
        deformers: [{ name: 'a', kind: 'translate', area: { cx: 50, cy: 50, rx: 40, ry: 40 } }]
    });

    const out = new Float32Array(base.length);

    applyRig(rig, out, {});

    assert.deepEqual(out, base);
});


// 4. Translate
test('translate mueve el centro completo y nada fuera del área', () => {
    const base = createGrid(100, 100, 11, 11);
    const rig = createRig({
        base,
        deformers: [{ name: 'a', kind: 'translate', area: { cx: 50, cy: 50, rx: 30, ry: 30 } }]
    });

    const out = new Float32Array(base.length);

    applyRig(rig, out, { a: { dx: 10, dy: -5 } });

    const center = (5 * 11 + 5) * 2;

    closeTo(out[center], 60);
    closeTo(out[center + 1], 45);

    const corner = 0;

    assert.equal(out[corner], base[corner]);
    assert.equal(out[corner + 1], base[corner + 1]);
});


// 5. Rotate
test('rotate gira alrededor del pivote con peso completo', () => {
    const base = new Float32Array([10, 0]);
    const rig = createRig({
        base,
        deformers: [{
            name: 'r',
            kind: 'rotate',
            pivot: { x: 0, y: 0 },
            area: { cx: 10, cy: 0, rx: 1000, ry: 1000 }
        }]
    });

    const out = new Float32Array(2);
    const weight = rig.deformers[0].weights[0];

    applyRig(rig, out, { r: { angle: Math.PI / 2 } });

    closeTo(out[0], 10 + (0 - 10) * weight, 1e-3);
    closeTo(out[1], 0 + 10 * weight, 1e-3);
});


// 6. Scale y squash
test('scale y squash respecto del pivote', () => {
    const base = new Float32Array([20, 20]);
    const deformer = (name, kind) => ({
        name,
        kind,
        pivot: { x: 10, y: 10 },
        area: { cx: 20, cy: 20, rx: 1e6, ry: 1e6 }
    });

    const rig = createRig({
        base,
        deformers: [deformer('s', 'scale'), deformer('q', 'squash')]
    });

    const out = new Float32Array(2);

    applyRig(rig, out, { s: { sx: 2, sy: 1 } });
    closeTo(out[0], 30, 1e-3);
    closeTo(out[1], 20, 1e-3);

    applyRig(rig, out, { q: { amount: 1 } });
    closeTo(out[0], 20, 1e-3);
    closeTo(out[1], 10, 1e-3);
});


// 7. Gate
test('gate below: la mandíbula no mueve lo que está sobre la boca', () => {
    const base = new Float32Array([50, 20, 50, 80]);
    const rig = createRig({
        base,
        deformers: [{
            name: 'jaw',
            kind: 'translate',
            area: { cx: 50, cy: 50, rx: 1000, ry: 1000 },
            gate: { below: 50, soft: 5 }
        }]
    });

    const out = new Float32Array(4);

    applyRig(rig, out, { jaw: { dy: 10 } });

    assert.equal(out[1], 20);
    assert.ok(out[3] > 89);
});


// 8. Rig real: la bola y la mesa nunca se mueven
test('Rig del mago: bola de cristal y mesa quedan inmóviles', () => {
    const base = createGrid(TEXTURE_SIZE.width, TEXTURE_SIZE.height, 100, 164);
    const rig = createRig({ base, deformers: DEFORMERS, pins: PINS });

    const extreme = {};

    for (const deformer of DEFORMERS) {
        extreme[deformer.name] = {
            dx: 40, dy: 40, angle: 0.3, sx: 1.3, sy: 1.3, amount: 1
        };
    }

    const out = new Float32Array(base.length);

    applyRig(rig, out, extreme);

    for (let v = 0; v < base.length / 2; v++) {
        const x = base[v * 2];
        const y = base[v * 2 + 1];

        const inBall = Math.hypot(x - 515, y - 855) <= 150;
        const onTable = y >= 1075 + 18;

        if (inBall || onTable) {
            closeTo(out[v * 2], x, 1e-3);
            closeTo(out[v * 2 + 1], y, 1e-3);
        }
    }
});


// 9. Rig real: cada deformador afecta vértices
test('Rig del mago: ningún deformador quedó vacío', () => {
    const base = createGrid(TEXTURE_SIZE.width, TEXTURE_SIZE.height, 100, 164);
    const rig = createRig({ base, deformers: DEFORMERS, pins: PINS });

    for (const deformer of rig.deformers) {
        assert.ok(
            deformer.indices.length > 0,
            `${deformer.name} no afecta ningún vértice`
        );
    }
});


// 10. Tipo inválido
test('applyRig rechaza tipos desconocidos', () => {
    const rig = createRig({
        base: new Float32Array([0, 0]),
        deformers: [{ name: 'x', kind: 'bailar', area: { cx: 0, cy: 0, rx: 10, ry: 10 } }]
    });

    assert.throws(
        () => applyRig(rig, new Float32Array(2), { x: {} }),
        /desconocido/
    );
});


// 11. SpeechLevel: callado cuando no habla
test('SpeechLevel vuelve a 0 cuando no habla', () => {
    const speech = new SpeechLevel({ random: () => 0.5 });

    for (let i = 0; i < 30; i++) {
        speech.update(1 / 60, true);
    }

    for (let i = 0; i < 60; i++) {
        speech.update(1 / 60, false);
    }

    assert.ok(speech.level < 0.01);
});


// 12. SpeechLevel: se mueve mientras habla
test('SpeechLevel abre la mandíbula mientras habla', () => {
    const speech = new SpeechLevel({ random: () => 0.5 });

    let max = 0;

    for (let i = 0; i < 120; i++) {
        max = Math.max(max, speech.update(1 / 60, true));
    }

    assert.ok(max > 0.3 && max <= 1);
});


// 13. SpeechLevel: nivel externo (TTS) tiene prioridad y expira
test('SpeechLevel usa nivel externo y vuelve al sintético al expirar', () => {
    const speech = new SpeechLevel({ random: () => 0.5 });

    for (let i = 0; i < 30; i++) {
        speech.setExternalLevel(0.8);
        speech.update(1 / 60, false);
    }

    closeTo(speech.level, 0.8, 0.02);

    for (let i = 0; i < 60; i++) {
        speech.update(1 / 60, false);
    }

    assert.ok(speech.level < 0.01);
});


test('weightRigValue: 1 no cambia, 0 deja cada tipo en su neutro, 0.5 a mitad', () => {
    const cases = {
        translate: [{ dx: 10, dy: -4 }, { dx: 0, dy: -0 }, { dx: 5, dy: -2 }],
        rotate: [{ angle: 0.2 }, { angle: 0 }, { angle: 0.1 }],
        scale: [{ sx: 1.2, sy: 0.8 }, { sx: 1, sy: 1 }, { sx: 1.1, sy: 0.9 }],
        squash: [{ amount: 0.9 }, { amount: 0 }, { amount: 0.45 }]
    };

    for (const [kind, [value, neutral, half]] of Object.entries(cases)) {
        for (const [weight, expected] of [[1, value], [0, neutral], [0.5, half]]) {
            const copy = { ...value };

            weightRigValue(kind, copy, weight);

            for (const key in expected) {
                closeTo(copy[key], expected[key]);
            }
        }
    }
});

test('baseOnly: solo manos y ojos, que están anclados a la imagen base', () => {
    const baseOnly = DEFORMERS.filter(d => d.baseOnly).map(d => d.name).sort();

    assert.deepEqual(baseOnly, ['blinkLeft', 'blinkRight', 'handLeft', 'handRight']);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de warp/speech superadas correctamente.`
);
