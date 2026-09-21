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

/*
 * Reconocer lo que hace el público (entrar, saludar, compartir, un like)
 * depende de cuánta gente haya. Con la sala vacía el mago saluda a todos;
 * con la sala llena sería una ametralladora de frases repetidas, que es
 * justo lo que TikTok castiga. Qué parte se reconoce, de 0 a 1:
 */
const ACK_RATE = Object.freeze({
    member:   Object.freeze({ quiet: 1,   warming: 0.3, busy: 0 }),
    greeting: Object.freeze({ quiet: 1,   warming: 0.5, busy: 0 }),
    share:    Object.freeze({ quiet: 1,   warming: 0.5, busy: 0 }),
    like:     Object.freeze({ quiet: 1,   warming: 0,   busy: 0 }),
    emoji:    Object.freeze({ quiet: 0.5, warming: 0,   busy: 0 }),
    quota:    Object.freeze({ quiet: 1,   warming: 0.5, busy: 0.3 })
});

/* Cada cuánto, como mucho, se reconoce algo de este tipo. */
const ACK_COOLDOWN_MS = Object.freeze({
    like: 180_000,
    emoji: 45_000
});

/* Entre dos reconocimientos siempre cabe la voz del anterior. */
const MIN_ACK_GAP_MS = 6_000;

/* ¿Pasó menos de `gapMs` desde `last`? Sin marca previa, nunca es pronto. */
const tooSoon = (last, gapMs, now) => last != null && now - last < gapMs;

export class ActivityDirector {

    #interactions = [];
    #viewers = 0;
    #startedAt = null;
    #lastLineAt = null;
    #lastBusyAt = null;
    #recentLines = [];
    #lastAckAt = null;
    #lastAckByKind = new Map();

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

    /**
     * ¿El mago reconoce esto que acaba de pasar? Decide según cómo esté la
     * sala: cuanta menos gente, más atención personal recibe cada uno.
     *
     * Solo decide. Cuando la frase salió de verdad (con voz), se anota con
     * `registerAck`; si la voz falló, no se gasta el turno de nadie.
     *
     * @param {'member'|'greeting'|'share'|'like'|'emoji'|'quota'} kind
     * @returns {boolean}
     */
    allowAck(kind, now = Date.now(), random = Math.random) {

        if (!ACK_RATE[kind]) {
            return false;
        }

        /*
         * Lo barato primero: la mayoría de los likes muere aquí sin mirar
         * la sala. Y mientras el mago lee para alguien, no saluda a nadie.
         */
        if (
            tooSoon(this.#lastAckAt, MIN_ACK_GAP_MS, now) ||
            tooSoon(this.#lastBusyAt, MIN_SILENCE_MS, now) ||
            tooSoon(this.#lastAckByKind.get(kind), ACK_COOLDOWN_MS[kind] ?? 0, now)
        ) {
            return false;
        }

        const rate = ACK_RATE[kind][this.mood(now)] ?? 0;

        return rate > 0 && (rate >= 1 || random() < rate);
    }

    /** El reconocimiento salió: cuenta para el hueco mínimo y el cooldown. */
    registerAck(kind, now = Date.now()) {
        this.#lastAckAt = now;
        this.#lastAckByKind.set(kind, now);
    }

    /* Las marcas llegan en orden: se sueltan las viejas por delante, sin copiar. */
    #recent(now) {
        while (this.#interactions.length > 0 && now - this.#interactions[0] >= WINDOW_MS) {
            this.#interactions.shift();
        }

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

        /* Ni pisando un saludo que acaba de salir. */
        if (this.#lastAckAt !== null && now - this.#lastAckAt < MIN_ACK_GAP_MS) {
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

export {
    ACK_COOLDOWN_MS,
    ACK_RATE,
    BUSY_INTERACTIONS,
    FIRST_LINE_MS,
    IDLE_EVERY_MS,
    MIN_ACK_GAP_MS,
    MIN_SILENCE_MS,
    WINDOW_MS
};
