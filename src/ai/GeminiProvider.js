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
                            maxOutputTokens: 512
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

            const text =
                this.#extractText(data);

            if (!text) {
                const error = new Error(
                    'Gemini devolvió una respuesta vacía'
                );

                error.code = 'GEMINI_EMPTY_RESPONSE';

                throw error;
            }

            this.stats.completed++;

            return {
                text,

                metadata: {
                    provider: 'gemini',
                    model: this.model,

                    finishReason:
                        data?.candidates?.[0]
                            ?.finishReason ?? null,

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
                    '',
                    `Usuario: @${username}`,
                    `Regalo: ${event.gift?.giftName ?? 'regalo'}`
                ].join('\n');

            default:
                return [
                    'Eres el asistente de un avatar virtual en una transmisión en vivo.',
                    'Genera una respuesta breve y natural para el evento recibido.',
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