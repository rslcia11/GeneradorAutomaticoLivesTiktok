import assert from 'node:assert/strict';

import { DEFAULT_CONTACT, readStreamerConfig, resolveContact } from './config/streamerConfig.js';

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
            contact: { enabled: true, text: 'Escríbeme al 0999999999', visibleSeconds: 8, everyMinutes: 6 }
        })
    });

    assert.deepEqual(resolveContact(file, {}), {
        enabled: true,
        text: 'Escríbeme al 0999999999',
        visibleSeconds: 8,
        everyMinutes: 6
    });
});

test('El entorno manda sobre el archivo', () => {
    const file = { contact: { enabled: true, text: 'Del archivo', everyMinutes: 6 } };

    const contact = resolveContact(file, {
        CONTACT_ENABLED: 'false',
        CONTACT_TEXT: 'Del entorno',
        CONTACT_EVERY_MINUTES: '3'
    });

    assert.equal(contact.enabled, false);
    assert.equal(contact.text, 'Del entorno');
    assert.equal(contact.everyMinutes, 3);
});

test('Sin texto nunca se enciende, aunque esté marcada como activa', () => {
    assert.equal(resolveContact({ contact: { enabled: true, text: '   ' } }, {}).enabled, false);
    assert.equal(resolveContact({ contact: { enabled: true } }, {}).enabled, false);
});

test('Valores inválidos vuelven a los tiempos por defecto', () => {
    const contact = resolveContact(
        { contact: { enabled: true, text: 'Hola', visibleSeconds: 'muchos', everyMinutes: -5 } },
        {}
    );

    assert.equal(contact.visibleSeconds, DEFAULT_CONTACT.visibleSeconds);
    assert.equal(contact.everyMinutes, DEFAULT_CONTACT.everyMinutes);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de configuración del streamer superadas correctamente.`
);
