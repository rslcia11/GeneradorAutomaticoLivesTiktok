import assert from 'node:assert/strict';

import { DEFAULT_CONTACT, readStreamerConfig, resolveContact, resolvePromo, resolveServiceMenu, resolveTiktokUsername } from './config/streamerConfig.js';

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

const missing = () => {
    const error = new Error('no existe');
    error.code = 'ENOENT';
    throw error;
};


test('Sin archivo, la franja queda apagada y no se avisa nada', () => {
    let warned = 0;

    const file = readStreamerConfig('./no-existe.json', { read: missing, warn: () => warned++ });

    assert.deepEqual(file, {});
    assert.equal(warned, 0, 'no tener el archivo es normal, no es un error');

    assert.deepEqual(resolveContact(file, {}), { ...DEFAULT_CONTACT });
});

test('Un archivo roto avisa pero no tumba la app', () => {
    const warnings = [];

    const file = readStreamerConfig('./roto.json', {
        read: () => '{ esto no es json',
        warn: message => warnings.push(message)
    });

    assert.deepEqual(file, {});
    assert.equal(warnings.length, 1);
});

test('Lee la frase y el teléfono del archivo', () => {
    const file = readStreamerConfig('./x.json', {
        read: () => JSON.stringify({
            contact: {
                enabled: true,
                text: 'Escríbeme al 0999999999',
                visibleSeconds: 8,
                gapMinSeconds: 20,
                gapMaxSeconds: 40
            }
        })
    });

    assert.deepEqual(resolveContact(file, {}), {
        enabled: true,
        text: 'Escríbeme al 0999999999',
        phone: '',
        visibleSeconds: 8,
        gapMinSeconds: 20,
        gapMaxSeconds: 40
    });
});

test('El entorno manda sobre el archivo', () => {
    const file = { contact: { enabled: true, text: 'Del archivo', gapMaxSeconds: 90 } };

    const contact = resolveContact(file, {
        CONTACT_ENABLED: 'false',
        CONTACT_TEXT: 'Del entorno',
        CONTACT_GAP_MAX_SECONDS: '45'
    });

    assert.equal(contact.enabled, false);
    assert.equal(contact.text, 'Del entorno');
    assert.equal(contact.gapMaxSeconds, 45);
});

test('El hueco entre apariciones se mide en segundos, no en minutos', () => {
    /* Antes era un compás fijo (`everyMinutes`); ahora es un rango al azar. */
    const contact = resolveContact({ contact: { enabled: true, text: 'Hola' } }, {});

    assert.equal(contact.gapMinSeconds, 15);
    assert.equal(contact.gapMaxSeconds, 60);
    assert.equal(contact.everyMinutes, undefined, 'ya no existe el compás fijo');

    /* Un .env viejo con CONTACT_EVERY_MINUTES no vuelve a imponer minutos. */
    const viejo = resolveContact({}, { CONTACT_ENABLED: 'true', CONTACT_TEXT: 'Hola', CONTACT_EVERY_MINUTES: '6' });

    assert.equal(viejo.gapMaxSeconds, 60);
    assert.equal(viejo.everyMinutes, undefined);
});

test('Sin texto ni teléfono nunca se enciende, aunque esté marcada como activa', () => {
    assert.equal(resolveContact({ contact: { enabled: true, text: '   ' } }, {}).enabled, false);
    assert.equal(resolveContact({ contact: { enabled: true } }, {}).enabled, false);
});

test('El teléfono del cartel fijo sale del archivo o del entorno, nunca del código', () => {
    const fromFile = resolveContact({ contact: { enabled: true, phone: ' 0999999999 ' } }, {});

    assert.equal(fromFile.phone, '0999999999');
    assert.equal(fromFile.enabled, true, 'solo con teléfono ya hay algo que mostrar');

    const fromEnv = resolveContact({ contact: { enabled: true, phone: '0999999999' } }, { CONTACT_PHONE: '0988888888' });

    assert.equal(fromEnv.phone, '0988888888');
    assert.equal(resolveContact({}, {}).phone, '');
});

test('Valores inválidos vuelven a los tiempos por defecto', () => {
    const contact = resolveContact(
        { contact: { enabled: true, text: 'Hola', visibleSeconds: 'muchos', gapMinSeconds: -5, gapMaxSeconds: '' } },
        {}
    );

    assert.equal(contact.visibleSeconds, DEFAULT_CONTACT.visibleSeconds);
    assert.equal(contact.gapMinSeconds, DEFAULT_CONTACT.gapMinSeconds);
    assert.equal(contact.gapMaxSeconds, DEFAULT_CONTACT.gapMaxSeconds);
});


// resolveTiktokUsername

test('Lee usuario de TikTok desde variable de entorno', () => {
    assert.equal(resolveTiktokUsername({}, { TIKTOK_USERNAME: 'mago_prueba' }), 'mago_prueba');
});

test('Lee usuario de TikTok desde el archivo cuando no hay env var', () => {
    assert.equal(resolveTiktokUsername({ tiktokUsername: 'mago_archivo' }, {}), 'mago_archivo');
});

test('Env var tiene prioridad sobre el archivo', () => {
    assert.equal(
        resolveTiktokUsername({ tiktokUsername: 'archivo' }, { TIKTOK_USERNAME: 'entorno' }),
        'entorno'
    );
});

test('Sin usuario en ningún lado lanza error claro', () => {
    assert.throws(() => resolveTiktokUsername({}, {}), /TIKTOK_USERNAME/);
});

test('Espacios en blanco no cuentan como usuario', () => {
    assert.throws(() => resolveTiktokUsername({}, { TIKTOK_USERNAME: '   ' }), /TIKTOK_USERNAME/);
});

// resolvePromo

test('Promo apagada por defecto (sin config)', () => {
    const promo = resolvePromo({}, {});
    assert.equal(promo.enabled, false);
    assert.equal(promo.text, '');
});

test('Promo activa desde el archivo', () => {
    const promo = resolvePromo({ promo: { enabled: true, text: 'Horóscopo de la semana' } }, {});
    assert.equal(promo.enabled, true);
    assert.equal(promo.text, 'Horóscopo de la semana');
});

test('Promo sin texto nunca se activa aunque enabled=true', () => {
    const promo = resolvePromo({ promo: { enabled: true, text: '  ' } }, {});
    assert.equal(promo.enabled, false);
});

test('Env var PROMO_TEXT tiene prioridad sobre el archivo', () => {
    const promo = resolvePromo(
        { promo: { enabled: true, text: 'Del archivo' } },
        { PROMO_TEXT: 'Del entorno', PROMO_ENABLED: 'true' }
    );
    assert.equal(promo.text, 'Del entorno');
    assert.equal(promo.enabled, true);
});


// resolveServiceMenu
test('El panel de recompensas está apagado si nadie lo pide', () => {
    assert.equal(resolveServiceMenu().enabled, false, 'sin configuración');
    assert.equal(resolveServiceMenu({}, {}).enabled, false);
    assert.equal(resolveServiceMenu({ serviceMenu: {} }, {}).enabled, false);
    assert.equal(resolveServiceMenu({ serviceMenu: { enabled: false } }, {}).enabled, false);
});

test('El panel de recompensas se enciende a propósito, por archivo o por entorno', () => {
    assert.equal(resolveServiceMenu({ serviceMenu: { enabled: true } }, {}).enabled, true);
    assert.equal(resolveServiceMenu({}, { SERVICE_MENU_ENABLED: 'true' }).enabled, true);

    /* El entorno manda sobre el archivo, como en contacto y promo. */
    assert.equal(
        resolveServiceMenu({ serviceMenu: { enabled: true } }, { SERVICE_MENU_ENABLED: 'false' }).enabled,
        false
    );
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de configuración del streamer superadas correctamente.`
);
