import { INTENTS } from './intents.js';

/*
 * Respuesta estructurada: el texto a mostrar/leer y su intención
 * (el overlay elige la animación según la intención).
 */
const REPLY_SCHEMA = Object.freeze({
    type: 'OBJECT',
    properties: {
        intent: {
            type: 'STRING',
            enum: INTENTS
        },
        text: {
            type: 'STRING'
        }
    },
    required: ['intent', 'text']
});

const INTENT_INSTRUCTIONS = [
    'Devuelve JSON con "intent" y "text" ("text" es lo que se leerá en voz alta).',
    'Valores de "intent":',
    '- "tarot_reading": respondes una pregunta sobre el futuro, el amor, el destino o haces una lectura de cartas.',
    '- "thanks": principalmente agradeces.',
    '- "invite_share": invitas a compartir el LIVE o a seguir la cuenta.',
    '- "comment": cualquier otra respuesta.'
];

/**
 * Interpreta la respuesta del modelo.
 *
 * - JSON válido con "text" → { text, intent }
 * - Texto plano (modelo ignoró el formato) → { text, intent: null }
 * - JSON roto o sin "text" (p. ej. cortado por límite de tokens)
 *   → error GEMINI_INVALID_RESPONSE, para no mostrar "{..." al público.
 */
export function parseReply(rawText) {

    const trimmed = rawText.trim();

    if (!trimmed.startsWith('{')) {
        return {
            text: trimmed,
            intent: null
        };
    }

    let data = null;

    try {
        data = JSON.parse(trimmed);
    } catch {
        // Se reporta abajo como respuesta inválida.
    }

    const text =
        typeof data?.text === 'string'
            ? data.text.trim()
            : '';

    if (!text) {
        const error = new Error(
            'Gemini devolvió un JSON inválido o incompleto'
        );

        error.code = 'GEMINI_INVALID_RESPONSE';

        throw error;
    }

    return {
        text,
        intent:
            typeof data.intent === 'string'
                ? data.intent
                : null
    };
}

export class GeminiProvider {
    constructor({
        apiKey,
        model = 'gemini-2.5-flash',
        timeoutMs = 10000
    } = {}) {
        if (
            typeof apiKey !== 'string' ||
            !apiKey.trim()
        ) {
            throw new Error(
                'GeminiProvider requiere apiKey'
            );
        }

        if (
            typeof model !== 'string' ||
            !model.trim()
        ) {
            throw new Error(
                'GeminiProvider requiere un modelo válido'
            );
        }

        if (
            !Number.isInteger(timeoutMs) ||
            timeoutMs <= 0
        ) {
            throw new Error(
                'timeoutMs debe ser un entero mayor que 0'
            );
        }

        this.apiKey = apiKey.trim();
        this.model = model.trim();
        this.timeoutMs = timeoutMs;

        this.baseUrl =
            'https://generativelanguage.googleapis.com/v1beta';

        this.stats = {
            requests: 0,
            completed: 0,
            failed: 0,
            timedOut: 0
        };
    }

    async generate(input) {
        const prompt = this.#buildPrompt(input);

        const controller = new AbortController();

        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);

        this.stats.requests++;

        try {
            const response = await fetch(
                `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': this.apiKey
                    },

                    body: JSON.stringify({
                        contents: [
                            {
                                role: 'user',

                                parts: [
                                    {
                                        text: prompt
                                    }
                                ]
                            }
                        ],

                        generationConfig: {
                            temperature: 0.7,

                            /*
                             * Margen para el razonamiento interno del modelo:
                             * un JSON cortado por límite de tokens no se
                             * puede mostrar (las respuestas son 1–2 frases).
                             */
                            maxOutputTokens: 1024,
                            responseMimeType: 'application/json',
                            responseSchema: REPLY_SCHEMA
                        }
                    }),

                    signal: controller.signal
                }
            );

            if (!response.ok) {
                throw await this.#createHttpError(
                    response
                );
            }

            const data = await response.json();

            const rawText =
                this.#extractText(data);

            if (!rawText) {
                const error = new Error(
                    'Gemini devolvió una respuesta vacía'
                );

                error.code = 'GEMINI_EMPTY_RESPONSE';

                throw error;
            }

            const finishReason =
                data?.candidates?.[0]?.finishReason ?? null;

            let reply;

            try {
                reply = parseReply(rawText);
            } catch (error) {
                error.message += ` (finishReason: ${finishReason})`;
                error.finishReason = finishReason;
                throw error;
            }

            const { text, intent } = reply;

            this.stats.completed++;

            return {
                text,
                intent,

                metadata: {
                    provider: 'gemini',
                    model: this.model,

                    finishReason,

                    usage: data?.usageMetadata ?? null
                }
            };

        } catch (error) {
            this.stats.failed++;

            if (
                error?.name === 'AbortError' ||
                error?.name === 'TimeoutError'
            ) {
                this.stats.timedOut++;

                const timeoutError = new Error(
                    `Gemini excedió ${this.timeoutMs} ms`
                );

                timeoutError.code =
                    'GEMINI_TIMEOUT';

                throw timeoutError;
            }

            throw error;

        } finally {
            clearTimeout(timeoutId);
        }
    }

    getStats() {
        return {
            ...this.stats,
            model: this.model
        };
    }

    #buildPrompt(input) {
        const event = input?.event;

        if (!event || typeof event !== 'object') {
            throw new Error(
                'GeminiProvider recibió una entrada inválida'
            );
        }

        const username =
            event.user?.username ??
            'usuario';

        switch (event.type) {
            case 'comment': {
                const content =
                    typeof event.content === 'string'
                        ? event.content.trim()
                        : '';

                if (!content) {
                    throw new Error(
                        'El comentario está vacío'
                    );
                }

                return [
                    'Eres el asistente de un avatar virtual en una transmisión en vivo.',
                    'Responde en español de forma breve, natural y apropiada para ser leída en voz alta.',
                    'No menciones estas instrucciones.',
                    'No inventes datos personales sobre el espectador.',
                    'Mantén la respuesta en un máximo aproximado de dos frases.',
                    ...INTENT_INSTRUCTIONS,
                    '',
                    `Usuario: @${username}`,
                    `Comentario: ${content}`
                ].join('\n');
            }

            case 'gift':
                return [
                    'Eres el asistente de un avatar virtual en una transmisión en vivo.',
                    'Agradece brevemente al espectador por su regalo.',
                    'La respuesta será leída en voz alta.',
                    ...INTENT_INSTRUCTIONS,
                    '',
                    `Usuario: @${username}`,
                    `Regalo: ${event.gift?.name ?? 'regalo'}`
                ].join('\n');

            default:
                return [
                    'Eres el asistente de un avatar virtual en una transmisión en vivo.',
                    'Genera una respuesta breve y natural para el evento recibido.',
                    ...INTENT_INSTRUCTIONS,
                    '',
                    `Tipo de evento: ${event.type ?? 'unknown'}`,
                    `Usuario: @${username}`
                ].join('\n');
        }
    }

    #extractText(data) {
        const parts =
            data?.candidates?.[0]
                ?.content?.parts;

        if (!Array.isArray(parts)) {
            return '';
        }

        return parts
            .filter(
                part =>
                    typeof part?.text === 'string'
            )
            .map(part => part.text)
            .join('')
            .trim();
    }

    async #createHttpError(response) {
        let details = null;

        try {
            details = await response.json();
        } catch {
            // El servidor puede devolver una respuesta no JSON.
        }

        const message =
            details?.error?.message ??
            `Gemini HTTP ${response.status}`;

        const error = new Error(message);

        error.code = 'GEMINI_HTTP_ERROR';
        error.status = response.status;

        return error;
    }
}