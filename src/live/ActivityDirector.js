/**
 * Director de la sala: decide qué hace el mago cuando nadie pregunta.
 *
 * Con poca gente y sin comentarios, el LIVE se queda quieto: eso aburre al
 * público y TikTok lo lee como transmisión desatendida. Entonces el mago
 * toma la iniciativa (invita, cuenta algo, hace un gesto). Cuando la sala
 * está activa, se calla: las interacciones ya dan movimiento.
 *
 * Es lógica pura, sin relojes ni red: recibe `now` y devuelve qué hacer.
 */

/* Una sala "activa" es la que comenta sola. */
const BUSY_INTERACTIONS = 3;

/* Ventana en la que se cuentan las interacciones recientes. */
const WINDOW_MS = 120_000;

/* Cada cuánto habla solo el mago, según cómo esté la sala. */
const IDLE_EVERY_MS = Object.freeze({
    quiet: 75_000,
    warming: 150_000,
    busy: 300_000
});

/* Nunca habla solo encima de una respuesta ni recién empezado el LIVE. */
const MIN_SILENCE_MS = 20_000;
const FIRST_LINE_MS = 45_000;

export class ActivityDirector {

    #interactions = [];
    #viewers = 0;
    #startedAt = null;
    #lastLineAt = null;
    #lastBusyAt = null;
    #recentLines = [];

    /**
     * @param {object} options
     * @param {(context: object) => string|{ text: string, intent?: string }} options.line
     *   qué dice el mago; puede traer la intención (invite_share, tarot_reading...)
     * @param {number} [options.memory]  cuántas frases no se repiten seguidas
     *   (en una sala callada son ~15 min de charla sin repetirse)
     */
    constructor({ line, memory = 12 } = {}) {
        this.line = line;
        this.memory = memory;
    }

    start(now = Date.now()) {
        this.#startedAt = now;
    }

    /** Espectadores en la sala (evento room_user). */
    setViewers(viewers) {
        this.#viewers = Number.isFinite(viewers) && viewers > 0 ? viewers : 0;
    }

    /** Un comentario, un regalo, un follow: alguien está ahí. */
    registerInteraction(now = Date.now()) {
        this.#interactions.push(now);
    }

    /** Mientras el mago habla o piensa, el director no interrumpe. */
    registerBusy(now = Date.now()) {
        this.#lastBusyAt = now;
    }

    #recent(now) {
        this.#interactions = this.#interactions.filter(time => now - time < WINDOW_MS);

        return this.#interactions.length;
    }

    /**
     * Cómo está la sala ahora:
     *   quiet   → nadie comenta: hay que llamar la atención
     *   warming → alguien aparece: animar sin agobiar
     *   busy    → se mueve sola: el mago solo responde
     */
    mood(now = Date.now()) {
        const recent = this.#recent(now);

        if (recent >= BUSY_INTERACTIONS) {
            return 'busy';
        }

        return recent > 0 || this.#viewers >= 10 ? 'warming' : 'quiet';
    }

    /**
     * Qué toca hacer en este instante.
     *
     * @returns {{ mood: string, energy: number, speak: { text: string, intent: string }|null }}
     *   `energy` (0..1) es cuánta animación debe haber en escena.
     *   `speak` es lo que debe decir el mago y con qué intención, o null.
     */
    direct(now = Date.now()) {
        const mood = this.mood(now);
        const energy = mood === 'quiet' ? 1 : mood === 'warming' ? 0.65 : 0.35;

        return { mood, energy, speak: this.#nextLine(mood, now) };
    }

    #nextLine(mood, now) {

        if (this.#startedAt === null || typeof this.line !== 'function') {
            return null;
        }

        /* Ni encima del mago hablando, ni apenas abre el LIVE. */
        if (this.#lastBusyAt !== null && now - this.#lastBusyAt < MIN_SILENCE_MS) {
            return null;
        }

        if (now - this.#startedAt < FIRST_LINE_MS) {
            return null;
        }

        /* La primera frase sale al pasar la gracia; las demás, cada intervalo. */
        if (this.#lastLineAt !== null && now - this.#lastLineAt < IDLE_EVERY_MS[mood]) {
            return null;
        }

        const picked = this.line({
            mood,
            viewers: this.#viewers,
            avoid: [...this.#recentLines]
        });

        const text = typeof picked === 'string' ? picked : picked?.text;

        if (typeof text !== 'string' || text.trim() === '') {
            return null;
        }

        this.#lastLineAt = now;
        this.#recentLines.push(text);

        if (this.#recentLines.length > this.memory) {
            this.#recentLines.shift();
        }

        return { text, intent: picked?.intent ?? 'invite_share' };
    }
}

export { BUSY_INTERACTIONS, IDLE_EVERY_MS, WINDOW_MS, FIRST_LINE_MS, MIN_SILENCE_MS };
