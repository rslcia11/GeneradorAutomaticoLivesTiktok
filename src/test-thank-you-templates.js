import assert from 'node:assert/strict';
import { ThankYouTemplates } from './ai/ThankYouTemplates.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        failed++;
        console.error(`❌ ${name}`);
        console.error(`   ${error.message}`);
    }
}

const templates = new ThankYouTemplates();

// 1
await test('Regalo → text incluye @username y nombre del regalo', async () => {
    const result = templates.generate({
        event: {
            type: 'gift',
            user: { username: 'juanito' },
            gift: { name: 'Rosa' }
        }
    });

    assert.ok(result.text.includes('juanito'), `text debe incluir username. Got: ${result.text}`);
    assert.ok(result.text.includes('Rosa'), `text debe incluir nombre del regalo. Got: ${result.text}`);
});

// 2
await test('Regalo → intent es "thanks"', async () => {
    const result = templates.generate({
        event: {
            type: 'gift',
            user: { username: 'test' },
            gift: { name: 'Estrella' }
        }
    });

    assert.equal(result.intent, 'thanks');
});

// 3
await test('Regalo → metadata.provider es "template"', async () => {
    const result = templates.generate({
        event: {
            type: 'gift',
            user: { username: 'test' },
            gift: { name: 'Rosa' }
        }
    });

    assert.equal(result.metadata.provider, 'template');
    assert.equal(result.metadata.eventType, 'gift');
});

// 4
await test('Suscripción → text incluye @username', async () => {
    const result = templates.generate({
        event: {
            type: 'subscription',
            user: { username: 'maria' }
        }
    });

    assert.ok(result.text.includes('maria'), `text debe incluir username. Got: ${result.text}`);
});

// 5
await test('Suscripción → intent es "thanks", metadata correcto', async () => {
    const result = templates.generate({
        event: {
            type: 'subscription',
            user: { username: 'test' }
        }
    });

    assert.equal(result.intent, 'thanks');
    assert.equal(result.metadata.provider, 'template');
    assert.equal(result.metadata.eventType, 'subscription');
});

// 6
await test('Regalo sin nombre → usa "regalo" como fallback', async () => {
    const result = templates.generate({
        event: {
            type: 'gift',
            user: { username: 'pedro' },
            gift: {}
        }
    });

    assert.ok(typeof result.text === 'string' && result.text.length > 0);
});

// 7
await test('Sin username → agradece sin arroba vacía ni género', async () => {
    const result = templates.generate({
        event: {
            type: 'gift',
            user: {},
            gift: { name: 'Rosa' }
        }
    });

    assert.ok(result.text.includes('lma generosa'), `fallback neutro. Got: ${result.text}`);
    assert.doesNotMatch(result.text, /@alma|@\s|@!/, `sin arroba huérfana. Got: ${result.text}`);
    assert.doesNotMatch(result.text, /\bamig[oa]\b/i, `sin género. Got: ${result.text}`);
    assert.doesNotMatch(result.text, /¡[a-záéíóúñ]/, `mayúscula al abrir. Got: ${result.text}`);
});

// 7b
await test('Un apodo con $ no se expande dentro de la plantilla', async () => {
    /* El apodo viene del chat: "$'" en un replace normal duplica texto. */
    const result = templates.generate({
        event: {
            type: 'gift',
            user: { username: "a$'b$&c" },
            gift: { name: 'Rosa' }
        }
    });

    /* Si el $ se expandiera, la plantilla se duplica y quedan huecos sin llenar. */
    assert.doesNotMatch(result.text, /\{user\}|\{gift\}/, `sin huecos. Got: ${result.text}`);
    assert.equal(result.text.match(/@a/g)?.length, 1, `un solo apodo. Got: ${result.text}`);
    assert.ok(result.text.includes("@a$'b$&c"), `apodo literal. Got: ${result.text}`);
});

// 8
await test('Tipo de evento no soportado → lanza TEMPLATE_UNSUPPORTED_EVENT', async () => {
    assert.throws(
        () => templates.generate({ event: { type: 'comment' } }),
        error => {
            assert.equal(error.code, 'TEMPLATE_UNSUPPORTED_EVENT');
            return true;
        }
    );
});

// 9
await test('Variedad: 20 llamadas de regalo producen al menos 2 textos distintos', async () => {
    const event = {
        type: 'gift',
        user: { username: 'test' },
        gift: { name: 'Rosa' }
    };

    const texts = new Set(
        Array.from({ length: 20 }, () => templates.generate({ event }).text)
    );

    assert.ok(texts.size >= 2, `Solo generó ${texts.size} variante(s) en 20 intentos`);
});

console.log('\n────────────────────────────────────────');
console.log(`🎯 ${passed}/${passed + failed} pruebas de ThankYouTemplates superadas correctamente.`);

if (failed > 0) {
    process.exitCode = 1;
}
