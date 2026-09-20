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

test('GREETINGS tiene 12 entradas', () => {
    assert.equal(GREETINGS.length, 12);
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

console.log(`\n🎯 ${passed}/7 pruebas de LivenessContent superadas correctamente.`);
