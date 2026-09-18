/**
 * Ejecuta SOLO las suites de prueba offline (sin red, sin costo).
 *
 *   npm test
 *
 * ⚠️ No incluir aquí suites que usan servicios reales:
 *   test-adapter.js        → se conecta a un LIVE de TikTok
 *   test-gemini*.js        → consume cuota de la API de Gemini
 *   test-ai-overlay.js,
 *   test-realtime.js       → levantan el WebSocket en el puerto 8080
 * Esas se ejecutan a mano, a propósito.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUITES = [
    'logger',
    'rules',
    'queue',
    'event-processor',
    'queue-worker',
    'ai-service',
    'resilient-ai-provider',
    'gemini-provider',
    'thank-you-templates',
    'intents',
    'services',
    'gift-catalog',
    'streamer-config',
    'gateway',
    'retry',
    'hud',
    'stage',
    'interaction-presenter',
    'tarot-avatar',
    'warp',
    'poses',
    'cards',
    'edge-tts',
    'speech-player',
    'speech-service'
];

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const failed = [];

for (const suite of SUITES) {
    console.log(`\n━━━ test-${suite} ━━━`);

    const result = spawnSync(process.execPath, [`${SRC}test-${suite}.js`], {
        stdio: 'inherit',
        timeout: 60_000
    });

    if (result.status !== 0) {
        failed.push(suite);
    }
}

if (failed.length > 0) {
    console.error(`\n❌ Fallaron ${failed.length}/${SUITES.length} suites: ${failed.join(', ')}`);
    process.exit(1);
}

console.log(`\n✅ ${SUITES.length}/${SUITES.length} suites offline superadas.`);
