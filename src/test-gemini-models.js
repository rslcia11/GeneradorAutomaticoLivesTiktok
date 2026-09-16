import { GeminiProvider } from './ai/GeminiProvider.js';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('❌ GEMINI_API_KEY no está disponible.');
    process.exit(1);
}

/*
 * Candidatos relevantes para nuestro caso:
 * respuestas cortas y rápidas para TikTok LIVE.
 *
 * Evitamos Pro, imagen, TTS y modelos especializados.
 */
const models = [
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite'
];

const TEST_TIMEOUT_MS = 30000;
const PAUSE_BETWEEN_TESTS_MS = 3000;

const input = {
    event: {
        type: 'comment',

        user: {
            id: 'benchmark-user',
            username: 'usuario_prueba',
            nickname: 'Usuario Prueba'
        },

        content:
            'Hola, responde brevemente: ¿cómo estás?'
    },

    context: {
        platform: 'tiktok',
        environment: 'benchmark'
    }
};

const results = [];

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

console.log('🧪 Benchmark controlado de Gemini');
console.log(`📋 Modelos: ${models.length}`);
console.log('🔐 API key cargada: sí');
console.log('');

for (let index = 0; index < models.length; index++) {
    const model = models[index];

    console.log(
        `────────────────────────────────────────`
    );

    console.log(
        `🤖 [${index + 1}/${models.length}] ${model}`
    );

    const provider = new GeminiProvider({
        apiKey,
        model,
        timeoutMs: TEST_TIMEOUT_MS
    });

    const startedAt = performance.now();

    try {
        const response =
            await provider.generate(input);

        const elapsedMs =
            Math.round(
                performance.now() - startedAt
            );

        const usage =
            response.metadata?.usage ?? {};

        const result = {
            model,
            status: 'OK',
            latencyMs: elapsedMs,
            finishReason:
                response.metadata?.finishReason ?? null,
            promptTokens:
                usage.promptTokenCount ?? null,
            outputTokens:
                usage.candidatesTokenCount ?? null,
            thoughtsTokens:
                usage.thoughtsTokenCount ?? null
        };

        results.push(result);

        console.log('✅ RESPONDIÓ');
        console.log(`⏱️ ${elapsedMs} ms`);

        console.log(
            `🏁 Finish: ${result.finishReason}`
        );

        console.log(
            `💬 ${response.text}`
        );

        console.log(
            `📊 Tokens → prompt=${result.promptTokens ?? '-'} | ` +
            `output=${result.outputTokens ?? '-'} | ` +
            `thoughts=${result.thoughtsTokens ?? '-'}`
        );

    } catch (error) {
        const elapsedMs =
            Math.round(
                performance.now() - startedAt
            );

        const result = {
            model,
            status: 'ERROR',
            latencyMs: elapsedMs,
            http: error.status ?? null,
            code: error.code ?? 'UNKNOWN',
            message: error.message
        };

        results.push(result);

        console.log('❌ FALLÓ');
        console.log(`⏱️ ${elapsedMs} ms`);

        console.log(
            `🔢 HTTP: ${result.http ?? '-'}`
        );

        console.log(
            `🏷️ Código: ${result.code}`
        );

        console.log(
            `📝 ${result.message}`
        );
    }

    /*
     * Evitamos lanzar varias solicitudes seguidas.
     */
    if (index < models.length - 1) {
        console.log(
            `⏳ Esperando ${PAUSE_BETWEEN_TESTS_MS / 1000}s...`
        );

        await sleep(
            PAUSE_BETWEEN_TESTS_MS
        );
    }
}

console.log(
    '\n════════════════════════════════════════'
);

console.log('📊 RESUMEN');

console.table(
    results.map(result => ({
        model: result.model,
        status: result.status,
        latencyMs: result.latencyMs,
        http: result.http ?? '-',
        finish: result.finishReason ?? '-',
        code: result.code ?? '-'
    }))
);

const successful =
    results.filter(
        result => result.status === 'OK'
    );

console.log('');

if (successful.length === 0) {
    console.log(
        '⚠️ Ningún modelo respondió correctamente.'
    );
} else {
    console.log(
        `✅ ${successful.length}/${models.length} modelos respondieron.`
    );
}

/*
 * Este benchmark NO selecciona automáticamente
 * un modelo ganador.
 *
 * Primero revisaremos:
 * - disponibilidad;
 * - latencia;
 * - respuesta completa;
 * - finishReason;
 * - estabilidad.
 */
