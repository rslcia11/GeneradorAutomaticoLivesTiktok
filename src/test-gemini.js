import { AIService } from './ai/AIService.js';
import { GeminiProvider } from './ai/GeminiProvider.js';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error(
        '❌ GEMINI_API_KEY no está disponible.'
    );

    console.error(
        'Ejecuta Node con: --env-file=.env'
    );

    process.exit(1);
}

const provider = new GeminiProvider({
    apiKey,
    model: 'gemini-3.5-flash-lite',
    timeoutMs: 30000
});

const aiService = new AIService({
    provider,
    timeoutMs: 20000
});

console.log('🧪 Probando Gemini API...');
console.log(`🤖 Modelo: ${provider.model}`);

try {
    const result = await aiService.generateResponse({
        event: {
            type: 'comment',

            user: {
                id: 'test-user',
                username: 'usuario_prueba',
                nickname: 'Usuario Prueba'
            },

            content:
                'Hola, ¿puedes responder brevemente a este mensaje?'
        },

        context: {
            platform: 'tiktok',
            environment: 'test'
        }
    });

    console.log('\n✅ Gemini respondió correctamente');

    console.log(
        `💬 Respuesta: ${result.text}`
    );

    console.log(
        '\n📊 AIService:',
        aiService.getStats()
    );

    console.log(
        '📊 GeminiProvider:',
        provider.getStats()
    );

    console.log(
        '\n📦 Metadata:',
        result.metadata
    );

} catch (error) {
    console.error('\n❌ Falló la prueba de Gemini');

    console.error(
        `Código: ${error.code ?? 'UNKNOWN'}`
    );

    if (error.status) {
        console.error(
            `HTTP: ${error.status}`
        );
    }

    console.error(
        `Mensaje: ${error.message}`
    );

    console.error(
        '\n📊 AIService:',
        aiService.getStats()
    );

    console.error(
        '📊 GeminiProvider:',
        provider.getStats()
    );

    process.exitCode = 1;
}


