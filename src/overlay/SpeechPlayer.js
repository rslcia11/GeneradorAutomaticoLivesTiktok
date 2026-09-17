/**
 * SpeechPlayer
 *
 * Reproduce la voz de una respuesta ({ mimeType, data: base64 }) con
 * Web Audio y expone su volumen en tiempo real (0..1) para mover la
 * boca del avatar.
 *
 * Web Audio (y no <audio>): permite medir el volumen con AnalyserNode
 * y funciona en la fuente de navegador de OBS ("Controlar audio
 * mediante OBS" para que salga en el stream).
 *
 * El AudioContext es inyectable para probarlo en Node.
 */

/* resume() queda pendiente para siempre si el navegador bloquea el audio. */
const RESUME_TIMEOUT_MS = 300;

export class SpeechPlayer {

    constructor({
        createContext = () => new AudioContext(),

        /* La voz ronda RMS 0.05–0.25: se amplifica para abrir la boca. */
        levelGain = 4
    } = {}) {

        this.createContext = createContext;
        this.levelGain = levelGain;

        this.context = null;
        this.analyser = null;
        this.samples = null;

        this.source = null;
        this.generation = 0;
    }

    get playing() {
        return this.source !== null;
    }

    /**
     * Intenta habilitar el audio (llamar en un gesto del usuario:
     * clic o tecla). En OBS no hace falta.
     */
    unlock() {
        const context = this.#getContext();

        if (context.state === 'suspended') {
            context.resume().catch(() => {});
        }
    }

    /**
     * Reproduce el audio. Resuelve { durationMs } cuando empieza a sonar,
     * o null si mientras cargaba se pidió otro audio o stop().
     * Rechaza si el navegador bloquea el audio o no puede decodificarlo.
     */
    async play({ data } = {}) {

        this.stop();

        const generation = this.generation;

        if (typeof data !== 'string' || !data) {
            throw createError('AUDIO_INVALID', 'Audio sin datos');
        }

        const context = this.#getContext();

        if (context.state !== 'running') {
            await Promise.race([
                context.resume().catch(() => {}),
                new Promise(resolve => setTimeout(resolve, RESUME_TIMEOUT_MS))
            ]);
        }

        if (generation !== this.generation) {
            return null;
        }

        if (context.state !== 'running') {
            throw createError(
                'AUDIO_BLOCKED',
                'El navegador bloqueó el audio (haz clic en la página o usa OBS)'
            );
        }

        const buffer = await context.decodeAudioData(base64ToArrayBuffer(data));

        if (generation !== this.generation) {
            return null;
        }

        const source = context.createBufferSource();

        source.buffer = buffer;
        source.connect(this.analyser);

        source.onended = () => {
            if (this.source === source) {
                this.source = null;
            }
        };

        this.source = source;
        source.start();

        return { durationMs: buffer.duration * 1000 };
    }

    stop() {

        this.generation++;

        const source = this.source;

        this.source = null;

        if (source) {
            source.onended = null;

            try {
                source.stop();
            } catch {
                // Ya había terminado.
            }

            source.disconnect();
        }
    }

    /* Volumen actual (0..1). 0 si no está sonando. */
    get level() {

        if (!this.source) {
            return 0;
        }

        this.analyser.getFloatTimeDomainData(this.samples);

        let sum = 0;

        for (const sample of this.samples) {
            sum += sample * sample;
        }

        const rms = Math.sqrt(sum / this.samples.length);

        return Math.min(1, rms * this.levelGain);
    }

    destroy() {

        this.stop();

        this.context?.close().catch(() => {});
        this.context = null;
    }

    #getContext() {

        if (!this.context) {
            this.context = this.createContext();

            this.analyser = this.context.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.connect(this.context.destination);

            this.samples = new Float32Array(this.analyser.fftSize);
        }

        return this.context;
    }
}

export function base64ToArrayBuffer(base64) {

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
}

function createError(code, message) {

    const error = new Error(message);

    error.code = code;

    return error;
}
