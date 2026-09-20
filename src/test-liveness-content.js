import assert from 'node:assert/strict';
import { INVITATIONS, READINGS, GREETINGS } from './ai/LivenessContent.js';

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

test('INVITATIONS tiene 15 entradas', () => {
    assert.equal(INVITATIONS.length, 15);
});

test('Cada INVITATION tiene text e intent invite_share', () => {
    for (const entry of INVITATIONS) {
        assert.equal(typeof entry.text, 'string');
        assert.ok(entry.text.length > 0);
        assert.equal(entry.intent, 'invite_share');
    }
});

test('READINGS tiene 20 entradas', () => {
    assert.equal(READINGS.length, 20);
});

test('Cada READING tiene card, text e intent tarot_reading', () => {
    for (const entry of READINGS) {
        assert.equal(typeof entry.card, 'string');
        assert.equal(typeof entry.text, 'string');
        assert.ok(entry.card.length > 0);
        assert.ok(entry.text.length > 0);
        assert.equal(entry.intent, 'tarot_reading');
    }
});

/*
 * El apodo de TikTok no dice el género de quien entra: "¡Bienvenido, Mayra!"
 * suena a máquina. Los saludos deben servir para cualquier persona.
 *
 * Esto es una lista negra, no una garantía: atrapa las fórmulas con las que
 * ya nos equivocamos. Al escribir un saludo nuevo, el criterio manda.
 * Ojo: "list" también atrapa el sustantivo "la lista"; no se usa aquí.
 */
const GENERO = /\b(?:bienvenid|viajer|list|amig|querid|seguid|preparad|dispuest)[oa]s?\b/i;

test('Hay variedad de saludos', () => {
    assert.ok(GREETINGS.length >= 20, `solo ${GREETINGS.length} saludos`);
});

test('Ningún saludo usa las fórmulas con género que ya nos fallaron', () => {
    for (const fn of GREETINGS) {
        const saludo = fn('x');

        assert.doesNotMatch(saludo, GENERO, saludo);
    }
});

test('Cada GREETING es función que devuelve string con el username', () => {
    for (const fn of GREETINGS) {
        assert.equal(typeof fn, 'function');
        const result = fn('TestUser');
        assert.equal(typeof result, 'string');
        assert.ok(result.includes('TestUser'));
    }
});

test('INVITATIONS, READINGS y GREETINGS son inmutables (Object.isFrozen)', () => {
    assert.ok(Object.isFrozen(INVITATIONS));
    assert.ok(Object.isFrozen(READINGS));
    assert.ok(Object.isFrozen(GREETINGS));
});

console.log(`\n🎯 ${passed}/8 pruebas de LivenessContent superadas correctamente.`);
