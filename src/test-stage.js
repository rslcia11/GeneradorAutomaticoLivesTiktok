import assert from 'node:assert/strict';

import { STAGE, renderResolution, stageScale } from './overlay/stage.js';

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

const closeTo = (actual, expected, epsilon = 1e-9) =>
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);


test('El escenario es 9:16, el formato de TikTok', () => {
    closeTo(STAGE.width / STAGE.height, 9 / 16);
});

test('En OBS (1080 × 1920) el escenario se ve al doble, exacto', () => {
    closeTo(stageScale(1080, 1920), 2);
});

test('Siempre entra completo: manda el lado más ajustado', () => {
    /* Monitor horizontal: sobra ancho, manda el alto. */
    closeTo(stageScale(1365, 648), 648 / STAGE.height);

    /* Celular: sobra alto, manda el ancho. */
    closeTo(stageScale(390, 844), 390 / STAGE.width);

    for (const [width, height] of [[1080, 1920], [1365, 648], [390, 844], [2560, 1440]]) {
        const scale = stageScale(width, height);

        assert.ok(STAGE.width * scale <= width + 1e-9, 'no se sale a lo ancho');
        assert.ok(STAGE.height * scale <= height + 1e-9, 'no se sale a lo alto');
    }
});

test('Una ventana imposible no rompe la escala', () => {
    assert.equal(stageScale(0, 0), 1);
    assert.equal(stageScale(NaN, 500), 1);
});

test('El mago se dibuja a la nitidez a la que se ve', () => {
    /* En OBS el escenario va ×2: el canvas también. */
    assert.equal(renderResolution(2, 1), 2);

    /* Pantalla normal, escenario achicado: nunca por debajo de 1 (borroso). */
    assert.equal(renderResolution(0.675, 1), 1);

    /*
     * Tope 2: la PC del streamer también está transmitiendo, y más
     * resolución gasta memoria de video sin verse mejor.
     */
    assert.equal(renderResolution(0.72, 3), 2);
    assert.equal(renderResolution(3, 4), 2);
});

console.log(
    `
🎯 ${passed}/${total} pruebas del escenario superadas correctamente.`
);
