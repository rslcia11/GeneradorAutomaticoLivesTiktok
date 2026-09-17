/**
 * SpeechService
 *
 * Convierte la respuesta de la IA en voz para el overlay.
 *
 * La voz es un EXTRA: si el proveedor falla (p. ej. Edge TTS cambia
 * o se corta), la respuesta se muestra igual, sin audio.
 *
 * Contrato del proveedor:
 *   synthesize(text) → Promise<{ data: Buffer, mimeType: string }>
 */
export class SpeechService {

    constructor({
        provider,
        logger = console
    } = {}) {

        if (
            !provider ||
            typeof provider.synthesize !== 'function'
        ) {
            throw new Error(
                'SpeechService requiere un provider con synthesize()'
            );
        }

        this.provider = provider;
        this.logger = logger;
    }

    /**
     * @returns {Promise<{ mimeType: string, data: string } | null>}
     *          audio en base64 (listo para JSON) o null si falló.
     */
    async synthesizeForOverlay(text) {

        try {
            const { data, mimeType } =
                await this.provider.synthesize(text);

            return {
                mimeType,
                data: data.toString('base64')
            };

        } catch (error) {
            this.logger.warn(
                `⚠️ Voz no disponible → ${error?.code ?? 'TTS_ERROR'}: ${error?.message ?? error}`
            );

            return null;
        }
    }

    getStats() {
        return this.provider.getStats?.() ?? null;
    }
}
