import assert from 'node:assert/strict';

import { INTENT, resolveIntent } from './ai/intents.js';
import { parseReply } from './ai/GeminiProvider.js';
import { AIService } from './ai/AIService.js';
import { ResilientAIProvider } from './ai/ResilientAIProvider.js';

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;

    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}


// resolveIntent
await test('Regalo y suscripción siempre son agradecimiento', () => {
    assert.equal(resolveIntent({ type: 'gift' }, INTENT.TAROT_READING), INTENT.THANKS);
    assert.equal(resolveIntent({ type: 'subscription' }, null), INTENT.THANKS);
});

await test('Comentario usa la intención válida del modelo', () => {
    assert.equal(resolveIntent({ type: 'comment' }, 'tarot_reading'), INTENT.TAROT_READING);
    assert.equal(resolveIntent({ type: 'comment' }, 'invite_share'), INTENT.INVITE_SHARE);
});

await test('Intención ausente o inventada → comment', () => {
    assert.equal(resolveIntent({ type: 'comment' }, null), INTENT.COMMENT);
    assert.equal(resolveIntent({ type: 'comment' }, 'bailar'), INTENT.COMMENT);
});


// parseReply
await test('parseReply: JSON válido', () => {
    assert.deepEqual(
        parseReply(' {"intent":"tarot_reading","text":" Las cartas dicen... "} '),
        { text: 'Las cartas dicen...', intent: 'tarot_reading' }
    );
});

await test('parseReply: texto plano se acepta sin intención', () => {
    assert.deepEqual(
        parseReply('¡Hola, bienvenido!'),
        { text: '¡Hola, bienvenido!', intent: null }
    );
});

await test('parseReply: JSON cortado → GEMINI_INVALID_RESPONSE', () => {
    assert.throws(
        () => parseReply('{"intent":"comment","text":"A ver si pa'),
        error => error.code === 'GEMINI_INVALID_RESPONSE'
    );
});

await test('parseReply: JSON sin text → GEMINI_INVALID_RESPONSE', () => {
    assert.throws(
        () => parseReply('{"intent":"comment"}'),
        error => error.code === 'GEMINI_INVALID_RESPONSE'
    );
});


// AIService
await test('AIService devuelve la intención resuelta', async () => {
    const service = new AIService({
        provider: {
            async generate() {
                return { text: 'Las cartas hablan', intent: 'tarot_reading' };
            }
        }
    });

    const comment = await service.generateResponse({
        event: { type: 'comment', content: '¿Qué me depara el amor?' }
    });

    const gift = await service.generateResponse({
        event: { type: 'gift', gift: { name: 'Rose' } }
    });

    assert.equal(comment.intent, INTENT.TAROT_READING);
    assert.equal(gift.intent, INTENT.THANKS);
});

await test('AIService sin intención del provider → comment', async () => {
    const service = new AIService({
        provider: {
            async generate() {
                return { text: 'Hola' };
            }
        }
    });

    const result = await service.generateResponse({
        event: { type: 'comment', content: 'Hola' }
    });

    assert.equal(result.intent, INTENT.COMMENT);
});


// ResilientAIProvider
await test('JSON inválido del principal → usa fallback', async () => {
    const provider = new ResilientAIProvider({
        providers: [
            {
                async generate() {
                    const error = new Error('JSON roto');
                    error.code = 'GEMINI_INVALID_RESPONSE';
                    throw error;
                }
            },
            {
                async generate() {
                    return { text: 'respaldo', intent: 'comment' };
                }
            }
        ]
    });

    const result = await provider.generate({});

    assert.equal(result.text, 'respaldo');
    assert.equal(result.intent, 'comment');
    assert.equal(result.metadata.resilience.fallbackUsed, true);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de intenciones superadas correctamente.`
);
