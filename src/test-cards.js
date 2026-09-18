import assert from 'node:assert/strict';

import {
    CAMERA_DISTANCE,
    GRID,
    fillCardUVs,
    isMirrored,
    projectCardVertices,
    vertexCount
} from './overlay/animated/cardGeometry.js';

import {
    NEXT_PHASE,
    TIMING,
    cardProgress,
    cardTransform,
    phaseDuration,
    scrimTarget
} from './overlay/animated/cardChoreography.js';

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

const WIDTH = 190;
const HEIGHT = 316;

const SLOTS = [
    { x: 290, y: 1150, rotation: -0.2 },
    { x: 515, y: 1118, rotation: 0 },
    { x: 740, y: 1150, rotation: 0.2 }
];

const ORIGIN = { x: 515, y: 855 };

function project(options) {
    return projectCardVertices(
        new Float32Array(vertexCount() * 2),
        { width: WIDTH, height: HEIGHT, ...options }
    );
}

/* Vértice (columna, fila) como {x, y}. */
function vertex(data, column, row) {
    const index = (row * GRID.columns + column) * 2;

    return { x: data[index], y: data[index + 1] };
}

function transform(phase, time, index = 0, extra = {}) {
    return cardTransform({
        phase,
        time,
        index,
        count: SLOTS.length,
        slot: SLOTS[index],
        origin: ORIGIN,
        ...extra
    });
}


// ─── Proyección 3D ──────────────────────────────────────────────────────

test('Sin giro la carta es un rectángulo exacto centrado en el origen', () => {
    const data = project({ spinY: 0, tilt: 0 });

    const topLeft = vertex(data, 0, 0);
    const bottomRight = vertex(data, GRID.columns - 1, GRID.rows - 1);

    closeTo(topLeft.x, -WIDTH / 2, 1e-4);
    closeTo(topLeft.y, -HEIGHT / 2, 1e-4);
    closeTo(bottomRight.x, WIDTH / 2, 1e-4);
    closeTo(bottomRight.y, HEIGHT / 2, 1e-4);
});

test('De canto (90°) la carta no ocupa ancho', () => {
    const data = project({ spinY: Math.PI / 2 });

    for (let column = 0; column < GRID.columns; column++) {
        assert.ok(
            Math.abs(vertex(data, column, 0).x) < 1e-3,
            'a 90° todos los vértices caen sobre el eje'
        );
    }
});

test('A media vuelta el borde cercano es MÁS alto que el lejano (perspectiva real)', () => {
    const data = project({ spinY: Math.PI / 4 });

    /* Con spinY positivo el borde izquierdo es el que se acerca. */
    const near = Math.abs(vertex(data, 0, 0).y);
    const far = Math.abs(vertex(data, GRID.columns - 1, 0).y);

    assert.ok(near > far, `cercano ${near} debería superar a lejano ${far}`);
    assert.ok(near > HEIGHT / 2, 'el borde cercano crece respecto al reposo');
    assert.ok(far < HEIGHT / 2, 'el borde lejano se encoge');
});

test('Pasados los 180° la carta queda espejada', () => {
    const data = project({ spinY: Math.PI });

    closeTo(vertex(data, 0, 0).x, WIDTH / 2, 1e-4);
    closeTo(vertex(data, GRID.columns - 1, 0).x, -WIDTH / 2, 1e-4);
});

test('La perspectiva nunca se invierte: la cámara está lejos de la carta', () => {
    const halfDiagonal = Math.hypot(WIDTH, HEIGHT) / 2;

    assert.ok(halfDiagonal < CAMERA_DISTANCE / 2, 'sin riesgo de dividir por cero');

    for (const spinY of [0, 0.7, Math.PI / 2, 2.5, Math.PI, 5]) {
        for (const value of project({ spinY, tilt: 0.3 })) {
            assert.ok(Number.isFinite(value), `vértice no finito con spinY ${spinY}`);
        }
    }
});

test('La inclinación mueve la carta en vertical sin romper el ancho', () => {
    const flat = project({ tilt: 0 });
    const tilted = project({ tilt: 0.3 });

    assert.notEqual(vertex(tilted, 0, 0).y, vertex(flat, 0, 0).y);
    assert.ok(Math.abs(vertex(tilted, 0, 0).x) > 0);
});

test('Las UV espejadas evitan que el nombre de la carta se lea al revés', () => {
    const size = vertexCount() * 2;

    const normal = fillCardUVs(new Float32Array(size), {});
    const mirrored = fillCardUVs(new Float32Array(size), { mirrored: true });

    closeTo(normal[0], 0);
    closeTo(mirrored[0], 1);

    const lastU = (GRID.columns - 1) * 2;

    closeTo(normal[lastU], 1);
    closeTo(mirrored[lastU], 0);
});

test('El barrido de brillo desplaza las UV sin tocar la vertical', () => {
    const size = vertexCount() * 2;

    const still = fillCardUVs(new Float32Array(size), {});
    const swept = fillCardUVs(new Float32Array(size), { offsetU: 0.4 });

    closeTo(swept[0], still[0] - 0.4);
    closeTo(swept[1], still[1]);
});


// ─── Coreografía: salida de la bola ─────────────────────────────────────

test('Las cartas nacen en la bola y aterrizan en su lugar', () => {
    const born = transform('summon', 0);

    closeTo(born.x, ORIGIN.x, 1);
    closeTo(born.y, ORIGIN.y, 1);
    assert.ok(born.scale < 0.2, 'nace diminuta');
    assert.ok(born.alpha < 0.1, 'nace invisible');

    const landed = transform('summon', TIMING.summon);

    closeTo(landed.x, SLOTS[0].x, 1e-6);
    closeTo(landed.y, SLOTS[0].y, 1e-6);
    closeTo(landed.scale, 1, 1e-6);
    closeTo(landed.spinY, 0, 1e-6);
});

test('Al salir de la bola la carta nunca muestra su cara', () => {
    for (let time = 0; time <= TIMING.summon; time += 0.02) {
        assert.equal(transform('summon', time).faceUp, false);
    }
});

test('Las cartas salen escalonadas, no todas juntas', () => {
    const first = transform('summon', TIMING.summonStagger, 0);
    const third = transform('summon', TIMING.summonStagger, 2);

    assert.ok(first.scale > third.scale, 'la tercera todavía no arrancó');
    closeTo(cardProgress('summon', TIMING.summonStagger, 2), 0);
});


// ─── Coreografía: barajado ──────────────────────────────────────────────

test('El barajado empieza y termina exactamente en el lugar de cada carta', () => {
    for (let index = 0; index < SLOTS.length; index++) {
        for (const time of [0, TIMING.shuffle]) {
            const card = transform('shuffle', time, index);

            closeTo(card.x, SLOTS[index].x, 1e-6);
            closeTo(card.y, SLOTS[index].y, 1e-6);
            closeTo(card.scale, 1, 1e-6);
            closeTo(card.shade, 1, 1e-6);
            closeTo(card.rotation, SLOTS[index].rotation, 1e-6);
        }
    }
});

test('En el barajado las cartas de atrás se oscurecen y achican', () => {
    let sawBack = false;
    let sawFront = false;

    for (let time = 0.05; time < TIMING.shuffle; time += 0.02) {
        const card = transform('shuffle', time, 0);

        if (card.depth < -0.4) {
            sawBack = true;
            assert.ok(card.shade < 0.9, 'la de atrás se apaga');
            assert.ok(card.scale < 1, 'la de atrás se ve más chica');
        }

        if (card.depth > 0.4) {
            sawFront = true;
            assert.ok(card.shade === 1, 'la de adelante mantiene su color');
            assert.ok(card.scale > 1, 'la de adelante se agranda');
        }
    }

    assert.ok(sawBack && sawFront, 'el carrusel pasa por delante y por detrás');
});

test('El barajado es un carrusel: cada carta arranca en un punto distinto', () => {
    const depths = SLOTS.map((_, index) => transform('shuffle', 0.3, index).depth);

    assert.equal(new Set(depths.map(d => d.toFixed(4))).size, SLOTS.length);
});


// ─── Coreografía: la revelación ─────────────────────────────────────────

test('La carta voltea una sola vez y recién pasados los 90°', () => {
    let flips = 0;
    let previous = false;

    for (let time = 0; time <= TIMING.reveal; time += 0.01) {
        const card = transform('reveal', time, 0);

        if (card.faceUp !== previous) {
            flips++;
            previous = card.faceUp;

            assert.ok(card.spinY > Math.PI / 2, 'la cara aparece pasada la mitad del giro');
        }
    }

    assert.equal(flips, 1);
    assert.equal(previous, true, 'termina mostrando la cara');
});

test('La carta se acerca a cámara y vuelve a su tamaño', () => {
    const middle = transform('reveal', TIMING.reveal * 0.45, 0);
    const end = transform('reveal', TIMING.reveal, 0);

    assert.ok(middle.scale > 1.3, `debería agrandarse (${middle.scale})`);
    assert.ok(middle.y < SLOTS[0].y - 40, 'se levanta hacia la cámara');
    closeTo(middle.rotation, 0, 0.05);

    closeTo(end.scale, 1, 0.02);
});

test('El haz de luz y el fogonazo acompañan el volteo', () => {
    const before = transform('reveal', 0, 0);
    const flip = transform('reveal', TIMING.reveal * 0.42, 0);
    const end = transform('reveal', TIMING.reveal, 0);

    closeTo(before.beam, 0);
    assert.ok(flip.beam > 0.9, 'el haz está encendido al voltear');
    assert.ok(flip.flash > 0.9, 'hay fogonazo justo en el volteo');

    assert.ok(before.flash < 0.01 && end.flash < 0.01, 'el fogonazo es un instante');
    closeTo(end.beam, 0, 0.01);
});

test('Las cartas se revelan de a una', () => {
    const time = TIMING.reveal * 0.9;

    assert.equal(transform('reveal', time, 0).faceUp, true);
    assert.equal(transform('reveal', time, 2).faceUp, false);
    closeTo(cardProgress('reveal', time, 2), 0);
});

test('La carta ya revelada empieza a flotar en vez de quedarse congelada', () => {
    const justDone = transform('reveal', TIMING.reveal, 0, { clock: 10 });
    const later = transform('reveal', TIMING.reveal + 0.6, 0, { clock: 10.6 });

    assert.equal(justDone.faceUp, true);
    assert.notEqual(justDone.y, later.y);
    assert.ok(Math.abs(later.y - SLOTS[0].y) < 15, 'flota cerca de su lugar');
});


// ─── Coreografía: flotar y guardar ──────────────────────────────────────

test('Flotando la carta siempre mira a cámara', () => {
    for (let clock = 0; clock < 12; clock += 0.05) {
        const card = transform('hover', 0, 1, { clock });

        assert.equal(card.faceUp, true);
        assert.ok(Math.cos(card.spinY) < 0, 'el giro nunca vuelve al dorso');
        assert.ok(Math.abs(card.x - SLOTS[1].x) < 1e-9);
        assert.ok(Math.abs(card.y - SLOTS[1].y) < 15);
    }
});

test('El brillo recorre la carta cada tanto, no todo el tiempo', () => {
    let sweeping = 0;
    let quiet = 0;

    for (let clock = 0; clock < 10; clock += 0.05) {
        const { sheen } = transform('hover', 0, 0, { clock });

        if (sheen >= 0) {
            assert.ok(sheen <= 1);
            sweeping++;
        } else {
            quiet++;
        }
    }

    assert.ok(sweeping > 0 && quiet > sweeping, 'el barrido es ocasional');
});

test('La voz hace vibrar las cartas', () => {
    const silent = transform('hover', 0, 0, { clock: 3, talk: 0 });
    const loud = transform('hover', 0, 0, { clock: 3, talk: 1 });

    assert.ok(loud.glow > silent.glow);
    assert.ok(loud.scale > silent.scale);
    assert.ok(loud.y < silent.y, 'se levantan al hablar');
});

test('Al cerrar, las cartas vuelven a la bola y esconden su cara', () => {
    const from = { x: 740, y: 1150, rotation: 0.2, scale: 1, alpha: 1 };

    const start = transform('dismiss', 0, 2, { from });
    const end = transform('dismiss', TIMING.dismiss, 2, { from });

    closeTo(start.x, from.x, 1e-6);
    closeTo(start.y, from.y, 1e-6);
    closeTo(start.alpha, 1, 1e-6);

    closeTo(end.x, ORIGIN.x, 1e-6);
    closeTo(end.y, ORIGIN.y, 1e-6);
    closeTo(end.alpha, 0, 1e-6);
    assert.ok(end.scale < 0.1);
    assert.equal(end.faceUp, false, 'se guarda boca abajo');
});


test('Si la lectura se corta antes de revelar, la carta se va BOCA ABAJO', () => {
    /* Cortada en pleno barajado: boca abajo y con un giro cualquiera. */
    const from = { x: 400, y: 1130, rotation: 0.1, scale: 1.1, alpha: 1, spinY: 0.3, faceUp: false };

    const start = transform('dismiss', 0, 1, { from });

    closeTo(start.spinY, from.spinY, 1e-9);

    for (let time = 0; time <= TIMING.dismiss; time += 0.01) {
        assert.equal(
            transform('dismiss', time, 1, { from }).faceUp,
            false,
            'cerrar nunca destapa una carta que no se reveló'
        );
    }
});


// ─── Actos y continuidad ────────────────────────────────────────────────

test('Cada acto dura lo que tarda la última carta', () => {
    closeTo(phaseDuration('summon', 3), TIMING.summon + TIMING.summonStagger * 2);
    closeTo(phaseDuration('reveal', 3), TIMING.reveal + TIMING.revealStagger * 2);
    closeTo(phaseDuration('shuffle', 3), TIMING.shuffle);

    assert.equal(phaseDuration('hover', 3), Infinity, 'flotar dura lo que dure la respuesta');
});

test('Los actos se encadenan hasta flotar, y al cerrar se ocultan', () => {
    assert.equal(NEXT_PHASE.summon, 'shuffle');
    assert.equal(NEXT_PHASE.shuffle, 'reveal');
    assert.equal(NEXT_PHASE.reveal, 'hover');
    assert.equal(NEXT_PHASE.dismiss, 'hidden');
});

test('Entre acto y acto no hay saltos de posición ni de tamaño', () => {
    for (let index = 0; index < SLOTS.length; index++) {

        const landed = transform('summon', phaseDuration('summon', 3), index);
        const shuffleStart = transform('shuffle', 0, index);
        const shuffleEnd = transform('shuffle', TIMING.shuffle, index);
        const revealStart = transform('reveal', 0, index);

        for (const key of ['x', 'y', 'scale', 'rotation', 'shade']) {
            closeTo(landed[key], shuffleStart[key], 1e-6);
            closeTo(shuffleEnd[key], revealStart[key], 1e-6);
        }
    }
});

test('Nada se sale de rango en ningún momento de la lectura', () => {
    const from = { x: 300, y: 1100, rotation: 0, scale: 1, alpha: 1 };

    for (const phase of ['summon', 'shuffle', 'reveal', 'hover', 'dismiss']) {
        for (let time = 0; time <= 3; time += 0.02) {
            for (let index = 0; index < SLOTS.length; index++) {

                const card = transform(phase, time, index, { from, clock: time, talk: 0.5 });

                assert.ok(card.alpha >= 0 && card.alpha <= 1, `alpha ${card.alpha} en ${phase}`);
                assert.ok(card.scale > 0, `escala ${card.scale} en ${phase}`);
                assert.ok(card.shade > 0 && card.shade <= 1, `sombra ${card.shade} en ${phase}`);
                assert.ok(card.glow >= 0 && card.glow <= 1.2, `resplandor ${card.glow} en ${phase}`);
                assert.ok(card.beam >= 0 && card.beam <= 1, `haz ${card.beam} en ${phase}`);
                assert.ok(card.flash >= 0 && card.flash <= 1, `fogonazo ${card.flash} en ${phase}`);
                assert.ok(Number.isFinite(card.x) && Number.isFinite(card.y));
            }
        }
    }
});

test('Revelar → flotar empalma sin saltos', () => {
    for (let index = 0; index < SLOTS.length; index++) {
        for (const clock of [3, 7.3, 11.9]) {

            const end = TIMING.reveal + index * TIMING.revealStagger;

            const almost = transform('reveal', end - 1e-4, index, { clock, talk: 0.4 });
            const floating = transform('hover', 0, index, { clock, talk: 0.4 });

            for (const key of ['x', 'y', 'rotation', 'spinY', 'tilt', 'scale', 'glow']) {
                closeTo(almost[key], floating[key], 1e-3);
            }

            assert.equal(almost.faceUp, floating.faceUp);
        }
    }
});

test('El espejado depende SOLO del giro: también protege el dorso al salir de la bola', () => {
    assert.equal(isMirrored(0), false);
    assert.equal(isMirrored(Math.PI), true);
    assert.equal(isMirrored(Math.PI * 2), false);

    /* Al salir de la bola la malla da dos vueltas: pasa por tramos espejados. */
    let mirroredWhileFaceDown = false;

    for (let time = 0; time <= TIMING.summon; time += 0.01) {
        const card = transform('summon', time);

        if (!card.faceUp && isMirrored(card.spinY)) {
            mirroredWhileFaceDown = true;
        }
    }

    assert.ok(
        mirroredWhileFaceDown,
        'hay tramos con el dorso sobre la malla dada vuelta: por eso las UV siguen al giro y no a la cara'
    );
});

test('La coreografía es determinista: mismo instante, mismo resultado', () => {
    assert.deepEqual(transform('shuffle', 0.7, 1), transform('shuffle', 0.7, 1));
    assert.deepEqual(transform('reveal', 0.3, 0), transform('reveal', 0.3, 0));
});

test('El fondo se oscurece solo durante la lectura', () => {
    assert.equal(scrimTarget('hidden'), 0);
    assert.equal(scrimTarget('summon'), 0);
    assert.equal(scrimTarget('dismiss'), 0);

    assert.ok(scrimTarget('reveal') > scrimTarget('hover'));
    assert.ok(scrimTarget('hover') > scrimTarget('shuffle'));
    assert.ok(scrimTarget('reveal') < 0.5, 'el mago nunca queda a oscuras');
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de cartas superadas correctamente.`
);
