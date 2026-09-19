import assert from 'node:assert/strict';

import { ActivityDirector, FIRST_LINE_MS, IDLE_EVERY_MS, MIN_SILENCE_MS, WINDOW_MS } from './live/ActivityDirector.js';
import { idleLine, QUIET, WARMING } from './live/idleLines.js';

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

const START = 1_000_000;

/* Director con frases predecibles: "quiet-1", "warming-2"... */
function createDirector() {
    let counter = 0;

    const director = new ActivityDirector({
        line: ({ mood }) => `${mood}-${++counter}`
    });

    director.start(START);

    return director;
}


// 1. Ánimo de la sala
test('Sala vacía y callada: quiet; con gente o comentarios sueltos: warming', () => {
    const director = createDirector();

    assert.equal(director.mood(START), 'quiet');

    director.setViewers(12);
    assert.equal(director.mood(START), 'warming', 'hay público aunque no comente');

    director.setViewers(2);
    director.registerInteraction(START);
    assert.equal(director.mood(START), 'warming');
});

test('Tres interacciones recientes: la sala se mueve sola (busy)', () => {
    const director = createDirector();

    for (let i = 0; i < 3; i++) {
        director.registerInteraction(START + i * 1000);
    }

    assert.equal(director.mood(START + 3000), 'busy');

    /* Lo viejo deja de contar al salir de la ventana. */
    assert.equal(director.mood(START + WINDOW_MS + 4000), 'quiet');
});

test('La energía de la escena sube cuando la sala está muerta', () => {
    const director = createDirector();

    const quiet = director.direct(START);

    assert.equal(quiet.mood, 'quiet');
    assert.equal(quiet.energy, 1);

    for (let i = 0; i < 3; i++) {
        director.registerInteraction(START + i);
    }

    const busy = director.direct(START + 10);

    assert.equal(busy.mood, 'busy');
    assert.ok(busy.energy < quiet.energy, 'con sala activa, menos animación de relleno');
});


// 2. Cuándo habla solo
test('No habla apenas abre el LIVE', () => {
    const director = createDirector();

    assert.equal(director.direct(START).speak, null);
    assert.equal(director.direct(START + FIRST_LINE_MS - 1).speak, null);
    assert.equal(director.direct(START + FIRST_LINE_MS).speak, 'quiet-1');
});

test('Respeta el ritmo según el ánimo y no se repite en cada tic', () => {
    const director = createDirector();

    const first = START + FIRST_LINE_MS;

    assert.equal(director.direct(first).speak, 'quiet-1');
    assert.equal(director.direct(first + 1000).speak, null, 'no habla en cada tic');
    assert.equal(director.direct(first + IDLE_EVERY_MS.quiet).speak, 'quiet-2');
});

test('Con la sala activa habla mucho menos', () => {
    const director = createDirector();

    const first = START + FIRST_LINE_MS;

    director.direct(first);

    for (let i = 0; i < 3; i++) {
        director.registerInteraction(first + i);
    }

    /* Lo que en silencio ya tocaría, con sala activa todavía no. */
    assert.equal(director.direct(first + IDLE_EVERY_MS.quiet).speak, null);
    assert.equal(director.direct(first + WINDOW_MS - 1).speak, null, 'sigue callado mientras la sala comenta');

    /* Pasado el rato sin comentarios nuevos, retoma la iniciativa. */
    assert.equal(director.direct(first + IDLE_EVERY_MS.busy).speak, 'quiet-2');
});

test('Nunca habla encima del mago: espera tras una respuesta', () => {
    const director = createDirector();

    const when = START + FIRST_LINE_MS;

    director.registerBusy(when);

    assert.equal(director.direct(when + MIN_SILENCE_MS - 1).speak, null);
    assert.equal(director.direct(when + MIN_SILENCE_MS).speak, 'quiet-1');
});


// 3. Frases
test('Las frases evitan las últimas usadas', () => {
    const avoid = QUIET.slice(0, QUIET.length - 1);

    assert.equal(idleLine({ mood: 'quiet', avoid }), QUIET.at(-1));

    /* Si ya se usaron todas, vuelve a empezar en vez de quedarse muda. */
    assert.ok(QUIET.includes(idleLine({ mood: 'quiet', avoid: QUIET })));
});

test('Cada ánimo tiene su propio tono', () => {
    assert.ok(QUIET.includes(idleLine({ mood: 'quiet' }, () => 0)));
    assert.ok(WARMING.includes(idleLine({ mood: 'warming' }, () => 0)));
    assert.ok(QUIET.includes(idleLine({ mood: 'otro' }, () => 0)), 'ánimo desconocido → quiet');
});

test('Ninguna frase pide regalos, seguidores ni likes', () => {
    const prohibidas = /regal|dale like|sígueme|sigueme|comparte|comparta|suscrí|monedas|rosa/i;

    for (const line of [...QUIET, ...WARMING]) {
        assert.doesNotMatch(line, prohibidas, line);
    }
});

test('Las frases no se repiten entre sí', () => {
    assert.equal(new Set(QUIET).size, QUIET.length);
    assert.equal(new Set(WARMING).size, WARMING.length);
});


console.log(`\n🎯 ${passed}/${total} pruebas del director de sala superadas correctamente.`);
