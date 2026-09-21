import assert from 'node:assert/strict';

import {
    ACK_COOLDOWN_MS,
    ActivityDirector,
    FIRST_LINE_MS,
    IDLE_EVERY_MS,
    MIN_ACK_GAP_MS,
    MIN_SILENCE_MS,
    WINDOW_MS
} from './live/ActivityDirector.js';
import { BUSY, idleLine, QUIET, WARMING } from './live/idleLines.js';
import { ackLine, EMOJI, GREETING, LIKE, MEMBER, QUOTA, SHARE } from './live/ackLines.js';
import { GREETINGS, READINGS } from './ai/LivenessContent.js';
import { isQuestion } from './rules/questions.js';

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
    assert.equal(director.direct(START + FIRST_LINE_MS).speak?.text, 'quiet-1');
});

test('Respeta el ritmo según el ánimo y no se repite en cada tic', () => {
    const director = createDirector();

    const first = START + FIRST_LINE_MS;

    assert.equal(director.direct(first).speak?.text, 'quiet-1');
    assert.equal(director.direct(first + 1000).speak, null, 'no habla en cada tic');
    assert.equal(director.direct(first + IDLE_EVERY_MS.quiet).speak?.text, 'quiet-2');
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
    assert.equal(director.direct(first + IDLE_EVERY_MS.busy).speak?.text, 'quiet-2');
});

test('Nunca habla encima del mago: espera tras una respuesta', () => {
    const director = createDirector();

    const when = START + FIRST_LINE_MS;

    director.registerBusy(when);

    assert.equal(director.direct(when + MIN_SILENCE_MS - 1).speak, null);
    assert.equal(director.direct(when + MIN_SILENCE_MS).speak?.text, 'quiet-1');
});


// 3. Reconocer al público según la sala
/* Decide y, si salió, lo anota: como hace app.js al emitir. */
const ack = (director, kind, now, random) => {
    const spoke = director.allowAck(kind, now, random);

    if (spoke) {
        director.registerAck(kind, now);
    }

    return spoke;
};

test('Sala vacía: saluda a todo el que entra y contesta cada hola', () => {
    const director = createDirector();
    let now = START;

    for (const kind of ['member', 'greeting', 'share', 'member', 'greeting']) {
        assert.ok(ack(director, kind, now), `${kind} en sala vacía`);
        now += MIN_ACK_GAP_MS;
    }
});

test('Decidir no gasta el turno: solo emitir lo gasta', () => {
    const director = createDirector();

    assert.ok(director.allowAck('member', START));
    assert.ok(director.allowAck('share', START + 1), 'la decisión anterior no se emitió');

    director.registerAck('member', START + 1);
    assert.equal(director.allowAck('share', START + 2), false);
});

test('Mientras el mago lee para alguien, no saluda a nadie', () => {
    const director = createDirector();

    director.registerBusy(START);

    assert.equal(director.allowAck('member', START + MIN_SILENCE_MS - 1), false);
    assert.ok(director.allowAck('member', START + MIN_SILENCE_MS));
});

test('El director no habla solo pisando un saludo reciente', () => {
    const director = createDirector();
    const when = START + FIRST_LINE_MS;

    director.registerAck('member', when);

    assert.equal(director.direct(when + MIN_ACK_GAP_MS - 1).speak, null);
    assert.equal(director.direct(when + MIN_ACK_GAP_MS).speak?.text, 'quiet-1');
});

test('Sala movida: no reconoce nada, la sala ya se mueve sola', () => {
    const director = createDirector();

    for (let i = 0; i < 3; i++) {
        director.registerInteraction(START + i);
    }

    for (const kind of ['member', 'greeting', 'share', 'like', 'emoji']) {
        assert.equal(director.allowAck(kind, START + 10, () => 0), false, kind);
    }

    /* Avisar que ya usó su lectura sigue teniendo sentido, a veces. */
    assert.equal(director.allowAck('quota', START + 10, () => 0), true);
});

test('Sala tibia: reconoce una parte, según el azar', () => {
    const director = createDirector();

    director.setViewers(12);

    assert.equal(director.allowAck('member', START, () => 0.9), false, 'azar alto → no');
    assert.equal(director.allowAck('member', START, () => 0.1), true, 'azar bajo → sí');
    assert.equal(director.allowAck('like', START + MIN_ACK_GAP_MS, () => 0), false, 'likes solo en sala vacía');
});

test('Entre dos reconocimientos siempre cabe la voz del anterior', () => {
    const director = createDirector();

    assert.ok(ack(director, 'member', START));
    assert.equal(ack(director, 'share', START + MIN_ACK_GAP_MS - 1), false);
    assert.ok(ack(director, 'share', START + MIN_ACK_GAP_MS));
});

test('Los likes se agradecen como mucho cada tanto, aunque la sala esté vacía', () => {
    const director = createDirector();

    assert.ok(ack(director, 'like', START));
    assert.equal(ack(director, 'like', START + ACK_COOLDOWN_MS.like - 1), false);
    assert.ok(ack(director, 'like', START + ACK_COOLDOWN_MS.like));
});

test('Tipo desconocido: no se reconoce', () => {
    assert.equal(createDirector().allowAck('baile', START), false);
});

test('Las frases de reconocimiento llevan el apodo cuando lo hay', () => {
    assert.match(ackLine('member', { name: 'Mayra' }, () => 0), /Mayra/);
    assert.match(ackLine('greeting', { name: 'Mayra' }, () => 0), /Mayra/);
    assert.match(ackLine('quota', { name: 'Mayra' }, () => 0), /Mayra/);
    assert.equal(typeof ackLine('share', {}, () => 0), 'string');
    assert.equal(ackLine('baile'), null);
});

test('Dos compartidos seguidos no se agradecen con la misma frase', () => {
    const first = ackLine('share', {}, () => 0);
    const second = ackLine('share', { avoid: [first] }, () => 0);

    assert.notEqual(second, first);
    assert.ok(SHARE.includes(second));
});

test('Ningún reconocimiento pide ni promete nada a cambio', () => {
    const prohibidas = /regal|dale like|sígueme|sigueme|comparte|comparta|suscrí|monedas|\brosas?\b|recompensa|a cambio/i;
    const genero = /\b(?:bienvenid|viajer|list|amig|querid|seguid|preparad|dispuest)[oa]s?\b/i;

    for (const pool of [MEMBER, GREETING, SHARE, LIKE, EMOJI, QUOTA]) {
        for (const entry of pool) {
            const text = typeof entry === 'function' ? entry('x') : entry;

            assert.doesNotMatch(text, prohibidas, text);
            assert.doesNotMatch(text, genero, text);
        }
    }
});


// 4. Qué cuenta como pregunta (solo eso gasta la lectura del día)
test('Reconoce preguntas escritas como se escribe en el chat', () => {
    const preguntas = [
        '¿Qué dice el tarot sobre mi trabajo?',
        'me volvera a hablar',
        'dime algo de mi trabajo',
        'como me ira en el amor',
        'que ves en mi futuro',
        'sera que consigo trabajo',
        'mi ex regresara',
        'cuando llega el dinero',
        'quiero saber de mi pareja',
        'quiero una lectura de amor',
        'hola como me ira este año',
        'y cuando volvera mi ex',
        'podria irme del pais'
    ];

    for (const text of preguntas) {
        assert.ok(isQuestion(text), text);
    }
});

test('Un comentario suelto no es pregunta y no gasta la cuota', () => {
    const comentarios = [
        'Qué lindo tu gato negro',
        'que bonita historia',
        'maria estuvo aqui',
        'me gusta la feria',
        'saludos desde ecuador',
        'buenas noches a todos',

        /* Verbos de uso general y adverbios en medio de la frase. */
        'me ire a dormir chau',
        'me encanta como hablas',
        'seria genial',
        'cuando quieras',
        'estoy triste por mi ex',
        '',
        null
    ];

    for (const text of comentarios) {
        assert.equal(isQuestion(text), false, String(text));
    }
});


// 5. Frases
/* random alto → nunca saluda ni hace carta del día: invita. */
const invite = () => 0.99;

test('Las frases evitan las últimas usadas', () => {
    const avoid = QUIET.slice(0, -1);

    assert.deepEqual(idleLine({ mood: 'quiet', avoid }, invite), { text: QUIET.at(-1), intent: 'invite_share' });

    /* Si ya se usaron todas, vuelve a empezar en vez de quedarse muda. */
    assert.ok(QUIET.includes(idleLine({ mood: 'quiet', avoid: QUIET }, invite).text));
});

test('Cada ánimo tiene su propio tono', () => {
    assert.ok(QUIET.includes(idleLine({ mood: 'quiet' }, invite).text));
    assert.ok(WARMING.includes(idleLine({ mood: 'warming' }, invite).text));
    assert.ok(QUIET.includes(idleLine({ mood: 'otro' }, invite).text), 'ánimo desconocido → quiet');
});

test('Saluda a quien acaba de entrar, solo si la sala no está a tope', () => {
    const greeting = idleLine({ mood: 'quiet', newcomer: 'Mayra' }, () => 0);

    assert.match(greeting.text, /Mayra/);
    assert.equal(greeting.intent, 'invite_share');
    assert.ok(GREETINGS.some(build => build('Mayra') === greeting.text));

    /* Sin recién llegado no inventa nombres. */
    assert.doesNotMatch(idleLine({ mood: 'quiet', newcomer: null }, () => 0).text, /Mayra/);

    /* Con la sala activa no interrumpe para saludar. */
    assert.doesNotMatch(idleLine({ mood: 'busy', newcomer: 'Mayra' }, () => 0).text, /Mayra/);
});

test('A veces hace una carta del día: lectura corta con cartas en pantalla', () => {
    /* Sin recién llegado, la franja de lectura empieza en 0 (30 % en quiet). */
    const reading = idleLine({ mood: 'quiet' }, () => 0.2);

    assert.equal(reading.intent, 'tarot_reading');
    assert.ok(READINGS.some(entry => entry.text === reading.text), 'el texto ya nombra la carta');

    /* El hueco del saludo no se convierte en más lecturas. */
    assert.equal(idleLine({ mood: 'quiet' }, () => 0.4).intent, 'invite_share');

    /* Con la sala activa, nunca. */
    assert.equal(idleLine({ mood: 'busy' }, () => 0.2).intent, 'invite_share');
});

test('Ninguna frase pide regalos, seguidores ni likes', () => {
    const prohibidas = /regal|dale like|sígueme|sigueme|comparte|comparta|suscrí|monedas|\brosas?\b/i;

    for (const line of [...QUIET, ...WARMING, ...BUSY]) {
        assert.doesNotMatch(line, prohibidas, line);
    }

    for (const entry of READINGS) {
        assert.doesNotMatch(entry.text, prohibidas, entry.card);
    }

    for (const build of GREETINGS) {
        assert.doesNotMatch(build('x'), prohibidas);
    }
});

test('Catálogo agotado: recicla la más vieja, sin ping-pong entre dos frases', () => {
    /* BUSY tiene pocas frases: con la memoria del director caben todas. */
    let avoid = [...BUSY];
    const dichas = [];

    /* Sala siempre activa: habla 20 veces del mismo catálogo corto. */
    for (let i = 0; i < 20; i++) {
        const { text } = idleLine({ mood: 'busy', avoid }, () => (i * 7 % 20) / 20);

        dichas.push(text);
        avoid = [...avoid, text].slice(-12);
    }

    for (let i = 1; i < dichas.length; i++) {
        assert.notEqual(dichas[i], dichas[i - 1], 'repitió la anterior');
        assert.notEqual(dichas[i], dichas[i - 2], 'alternó entre dos frases');
    }
});

test('Las frases no se repiten entre sí', () => {
    const todas = [...QUIET, ...WARMING, ...BUSY];

    assert.equal(new Set(todas).size, todas.length);
});


console.log(`\n🎯 ${passed}/${total} pruebas del director de sala superadas correctamente.`);
