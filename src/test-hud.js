import assert from 'node:assert/strict';

import { Hud } from './overlay/hud.js';

/*
 * DOM mínimo simulado: el HUD solo crea elementos y cambia textos,
 * así que se puede probar en Node sin navegador.
 */

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

function createElement(tag = 'div') {
    return {
        tagName: tag,
        className: '',
        textContent: '',
        hidden: true,
        children: [],

        classList: {
            classes: new Set(),
            add(name) {
                this.classes.add(name);
            },
            remove(name) {
                this.classes.delete(name);
            },
            contains(name) {
                return this.classes.has(name);
            }
        },

        append(...nodes) {
            this.children.push(...nodes);
        },

        replaceChildren(...nodes) {
            this.children = nodes;
        }
    };
}

globalThis.document = { createElement };

function createHud() {
    const elements = {
        serviceMenu: createElement(),
        serviceMenuList: createElement('ul'),
        donorBoard: createElement(),
        donorBoardList: createElement('ol'),
        contactBanner: createElement(),
        serviceMenuTimer: createElement()
    };

    const timers = [];
    const repeating = [];

    const hud = new Hud({
        elements,
        setTimer: callback => {
            timers.push(callback);
            return timers.length;
        },
        clearTimer: () => {},
        setRepeating: (callback, ms) => {
            repeating.push({ callback, ms });
            return repeating.length;
        },
        clearRepeating: handle => repeating.splice(handle - 1, 1)
    });

    return { hud, elements, timers, repeating };
}

/* Busca en todo el árbol, no solo entre los hijos directos. */
const findIn = (element, matches) =>
    element.children.find(matches) ??
    element.children.map(child => findIn(child, matches)).find(Boolean);

/* Texto de un elemento y de todo lo que tenga dentro, a cualquier nivel. */
const textOf = element =>
    [element.textContent, ...element.children.map(textOf)]
        .filter(Boolean)
        .join(' ')
        .trim();


// 1. Menú de servicios
test('Pinta el menú con nombre y precio de cada servicio', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'service_menu',
        services: [
            { id: 'oraculo_dia', label: 'Oráculo del Día', coins: 29, style: 'short' },
            { id: 'lectura_3', label: 'Lectura 3 Cartas', coins: 200, style: 'reading' }
        ]
    });

    assert.equal(elements.serviceMenu.hidden, false);
    assert.equal(elements.serviceMenuList.children.length, 2);

    const first = textOf(elements.serviceMenuList.children[0]);

    assert.match(first, /Oráculo del Día/);
    assert.match(first, /29/);
    assert.match(textOf(elements.serviceMenuList.children[1]), /200/);
});

test('El menú muestra cuánto falta para la próxima pregunta gratis', () => {
    const { hud, elements, repeating } = createHud();

    hud.handle({ type: 'service_menu', services: [{ id: 'a', label: 'A', coins: 29, style: 'short' }] });

    /* Cuenta atrás hasta medianoche: mm:ss, o hh:mm:ss si falta más de una hora. */
    assert.match(elements.serviceMenuTimer.textContent, /^(\d{2}:)?\d{2}:\d{2}$/);
    assert.equal(repeating.length, 1, 'se refresca cada segundo');
    assert.equal(repeating[0].ms, 1000);

    /* Repintar el menú no deja dos cuentas atrás corriendo a la vez. */
    hud.handle({ type: 'service_menu', services: [{ id: 'a', label: 'A', coins: 29, style: 'short' }] });
    assert.equal(repeating.length, 1);

    hud.destroy();
    assert.equal(repeating.length, 0, 'al cerrar no queda nada corriendo');
});

test('Un menú vacío no deja el panel a medio pintar', () => {
    const { hud, elements } = createHud();

    hud.handle({ type: 'service_menu', services: [] });

    assert.equal(elements.serviceMenu.hidden, true);
});


// 2. Últimos en apoyar
test('Muestra los últimos donantes, el más reciente primero y resaltado', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'donor_board',
        donors: [
            { username: 'luna', nickname: 'Luna 🌙', gift: 'Rose', coins: 5 },
            { username: 'beto', nickname: null, gift: 'Doughnut', coins: 30 }
        ]
    });

    assert.equal(elements.donorBoard.hidden, false);

    const [newest, second] = elements.donorBoardList.children;

    assert.match(textOf(newest), /Luna 🌙/);
    assert.ok(newest.classList.contains('donor-board__item--new'));

    /* Sin apodo se muestra el usuario. */
    assert.match(textOf(second), /@beto/);
    assert.ok(!second.classList.contains('donor-board__item--new'));
});

test('Muestra como máximo 5 donantes', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'donor_board',
        donors: Array.from({ length: 9 }, (_, i) => ({
            username: `u${i}`, gift: 'Rose', coins: i
        }))
    });

    assert.equal(elements.donorBoardList.children.length, 5);
});

test('Sin donantes, la tabla sigue visible e invita a ser el primero', () => {
    const { hud, elements } = createHud();

    hud.handle({ type: 'donor_board', donors: [] });

    assert.equal(elements.donorBoard.hidden, false);
    assert.equal(elements.donorBoardList.children.length, 1);
    assert.match(textOf(elements.donorBoardList), /primero/);
});

test('El menú muestra el regalo ORIGINAL de TikTok y su precio real', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'service_menu',
        services: [{
            id: 'oraculo_dia',
            label: 'Oráculo del Día',
            coins: 29,
            style: 'short',
            tiktokGift: { name: 'Doughnut', image: 'https://p16-webcast.tiktokcdn.com/donut.png', coins: 30 }
        }]
    });

    const [item] = elements.serviceMenuList.children;
    const image = findIn(item, child => child.tagName === 'img');

    assert.ok(image, 'hay imagen del regalo');
    assert.equal(image.src, 'https://p16-webcast.tiktokcdn.com/donut.png');
    assert.equal(image.alt, 'Doughnut', 'el nombre del regalo va en la imagen');
    assert.equal(image.referrerPolicy, 'no-referrer');

    assert.match(textOf(item), /30/, 'precio del regalo real, no el del servicio');
    assert.doesNotMatch(textOf(item), /29/);
});

test('Sin la lista de la sala, el menú vuelve al ícono y al precio base', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'service_menu',
        services: [{ id: 'lectura_3', label: 'Lectura 3 Cartas', coins: 200, style: 'reading' }]
    });

    const [item] = elements.serviceMenuList.children;

    assert.ok(!findIn(item, child => child.tagName === 'img'));
    assert.match(textOf(item), /🃏/);
    assert.match(textOf(item), /200/);
});

test('La tabla muestra la imagen del regalo y marca al primero con corona', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'donor_board',
        donors: [
            { username: 'luna', gift: 'Rose', image: 'https://p16-webcast.tiktokcdn.com/rose.png', coins: 1 },
            { username: 'beto', gift: 'Doughnut', coins: 30 }
        ]
    });

    const [first, second] = elements.donorBoardList.children;

    assert.match(textOf(first), /👑/);
    assert.match(textOf(second), /2/);
    assert.ok(first.children.some(child => child.tagName === 'img' && child.src.endsWith('rose.png')));
    assert.ok(!second.children.some(child => child.tagName === 'img'), 'sin imagen no se inventa una');
});

test('En el menú, una imagen de regalo inválida vuelve al ícono', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'service_menu',
        services: [{
            id: 'oraculo_dia',
            label: 'Oráculo del Día',
            coins: 29,
            style: 'short',
            tiktokGift: { name: 'Doughnut', image: 'http://inseguro/donut.png', coins: 30 }
        }]
    });

    const [item] = elements.serviceMenuList.children;

    assert.ok(!findIn(item, child => child.tagName === 'img'));
    assert.match(textOf(item), /✨/, 'nunca queda un círculo vacío');
});

test('Solo se cargan imágenes https (nada de javascript: ni http)', () => {
    const { hud, elements } = createHud();

    hud.handle({
        type: 'donor_board',
        donors: [{ username: 'x', gift: 'Rose', image: 'javascript:alert(1)', coins: 1 }]
    });

    const image = elements.donorBoardList.children[0].children.find(child => child.tagName === 'img');

    assert.equal(image.src, undefined);
    assert.equal(image.hidden, true);
});


test('Los temporizadores por defecto funcionan como en el navegador', () => {
    /*
     * El navegador exige que setTimeout se llame con `window` como dueño:
     * guardarlo como propiedad y llamarlo con this.setTimer(...) lanza
     * "Illegal invocation". Node no lo exige, así que aquí se imita.
     */
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;

    const strict = (original, name) => function (...args) {
        if (this !== undefined && this !== globalThis) {
            throw new TypeError(`Illegal invocation: ${name}`);
        }

        return original.apply(globalThis, args);
    };

    globalThis.setTimeout = strict(realSetTimeout, 'setTimeout');
    globalThis.clearTimeout = strict(realClearTimeout, 'clearTimeout');

    try {
        const elements = {
            serviceMenu: createElement(),
            serviceMenuList: createElement('ul'),
            donorBoard: createElement(),
            donorBoardList: createElement('ol'),
            contactBanner: createElement()
        };

        /* Sin temporizadores inyectados: los de verdad. */
        const hud = new Hud({ elements });

        hud.handle({
            type: 'contact_banner',
            contact: { enabled: true, text: 'Escríbeme al 0999999999', visibleSeconds: 1, everyMinutes: 1 }
        });

        hud.destroy();

    } finally {
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
    }
});


// 3. Franja de contacto
test('La franja de contacto aparece y se va sola', () => {
    const { hud, elements, timers } = createHud();

    hud.handle({
        type: 'contact_banner',
        contact: { enabled: true, text: 'Consultas: +593...', visibleSeconds: 10, everyMinutes: 8 }
    });

    assert.equal(elements.contactBanner.textContent, 'Consultas: +593...');
    assert.equal(elements.contactBanner.hidden, true, 'no aparece de inmediato');

    timers[0]();
    assert.equal(elements.contactBanner.hidden, false, 'deja de estar oculta...');
    assert.ok(
        !elements.contactBanner.classList.contains('contact-banner--visible'),
        '...pero la entrada se anima en el turno siguiente, si no aparecería de golpe'
    );

    timers[1]();
    assert.ok(elements.contactBanner.classList.contains('contact-banner--visible'));

    timers[2]();
    assert.ok(!elements.contactBanner.classList.contains('contact-banner--visible'));

    timers[3]();
    assert.equal(elements.contactBanner.hidden, true);

    /* Y vuelve sola más tarde, sin usar setInterval. */
    assert.equal(timers.length, 5, 'queda agendada la próxima aparición');

    timers[4]();
    assert.equal(elements.contactBanner.hidden, false, 'segunda vuelta');

    hud.destroy();
});

test('Desactivada o sin texto, la franja nunca aparece', () => {
    for (const contact of [
        { enabled: false, text: 'Hola' },
        { enabled: true, text: '   ' },
        { enabled: true },
        undefined
    ]) {
        const { hud, elements, timers } = createHud();

        hud.handle({ type: 'contact_banner', contact });

        assert.equal(timers.length, 0);
        assert.equal(elements.contactBanner.hidden, true);
    }
});

test('El teléfono viaja DENTRO de la franja, nunca fijo en pantalla', () => {
    const { hud, elements, timers } = createHud();

    hud.handle({
        type: 'contact_banner',
        contact: { enabled: true, text: '¿Consulta personalizada?', phone: ' 0999999999 ' }
    });

    assert.match(elements.contactBanner.textContent, /¿Consulta personalizada\? 0999999999/);
    assert.equal(elements.contactBanner.hidden, true, 'todavía no se muestra: sale a los 15 s');
    assert.equal(timers.length, 1, 'queda programada la primera aparición');
});

test('Si la frase ya trae el número, no se repite', () => {
    const { hud, elements, timers } = createHud();

    hud.handle({
        type: 'contact_banner',
        contact: { enabled: true, text: 'Escríbeme al 0999999999', phone: '0999999999' }
    });

    assert.equal(elements.contactBanner.textContent, 'Escríbeme al 0999999999');
});

test('Solo con teléfono, la franja lo muestra igual', () => {
    const { hud, elements, timers } = createHud();

    hud.handle({ type: 'contact_banner', contact: { enabled: true, phone: '0999999999' } });

    assert.equal(elements.contactBanner.textContent, '0999999999');
});

test('Desactivado, no hay franja ni número en ninguna parte', () => {
    const { hud, elements, timers } = createHud();

    hud.handle({ type: 'contact_banner', contact: { enabled: false, phone: '0999999999' } });

    assert.equal(timers.length, 0);
    assert.equal(elements.contactBanner.hidden, true);
    assert.equal(elements.contactBanner.textContent, '');
});


// 4. Router
test('Solo maneja sus propios eventos', () => {
    const { hud } = createHud();

    assert.equal(hud.handle({ type: 'service_menu', services: [] }), true);
    assert.equal(hud.handle({ type: 'donor_board', donors: [] }), true);
    assert.equal(hud.handle({ type: 'contact_banner', contact: {} }), true);

    assert.equal(hud.handle({ type: 'ai_response' }), false);
    assert.equal(hud.handle({ type: 'gift' }), false);
    assert.equal(hud.handle(null), false);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas del HUD superadas correctamente.`
);
