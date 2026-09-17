/**
 * InteractionPresenter
 *
 * Presenta las interacciones de IA de una en una y en orden:
 *
 *   ai_processing → THINKING
 *   ai_response   → SPEAKING (duración estimada, o la real del
 *                   audio si se llama speechStarted)
 *   ai_error      → fallo visible durante failureDurationMs
 *
 * Por qué existe:
 * el backend procesa la cola más rápido de lo que el avatar
 * tarda en "decir" una respuesta. Sin un orden explícito,
 * cada interacción nueva pisaba a la anterior y las
 * respuestas prácticamente nunca llegaban a verse.
 *
 * Es el ÚNICO dueño del tiempo de una interacción:
 * un solo timer decide cuándo pasar a la siguiente.
 *
 * NO conoce el DOM ni el avatar: el overlay inyecta callbacks.
 * Así puede probarse en Node con timers simulados.
 */
export class InteractionPresenter {

    constructor({
        onThinking,
        onSpeaking,
        onFailed,
        onIdle,
        estimateDurationMs,

        failureDurationMs = 1600,

        /*
         * Debe ser mayor que lo máximo que tarda el backend en
         * enviar ai_response: AIService (35 s) + voz (6 s).
         * Evita que la presentación quede bloqueada si el
         * backend se reinicia en plena consulta.
         */
        thinkingTimeoutMs = 50000,

        /*
         * Máximo de interacciones esperando turno.
         * Con más, se descarta la más antigua.
         */
        maxPending = 5,

        /* Pausa breve tras terminar la voz, antes de la siguiente. */
        speechTailMs = 400,

        setTimer = (callback, ms) => setTimeout(callback, ms),
        clearTimer = id => clearTimeout(id)
    } = {}) {

        const callbacks = {
            onThinking,
            onSpeaking,
            onFailed,
            onIdle,
            estimateDurationMs
        };

        for (const [name, callback] of Object.entries(callbacks)) {
            if (typeof callback !== 'function') {
                throw new TypeError(
                    `InteractionPresenter requiere ${name}`
                );
            }
        }

        if (!Number.isInteger(maxPending) || maxPending <= 0) {
            throw new TypeError(
                'maxPending debe ser un entero mayor que 0'
            );
        }

        this.onThinking = onThinking;
        this.onSpeaking = onSpeaking;
        this.onFailed = onFailed;
        this.onIdle = onIdle;
        this.estimateDurationMs = estimateDurationMs;

        this.failureDurationMs = failureDurationMs;
        this.thinkingTimeoutMs = thinkingTimeoutMs;
        this.maxPending = maxPending;
        this.speechTailMs = speechTailMs;

        this.setTimer = setTimer;
        this.clearTimer = clearTimer;

        /*
         * entry = {
         *   id,
         *   processingEvent,
         *   outcome: null | { type: 'response' | 'error', event }
         * }
         */
        this.current = null;
        this.pending = [];
        this.timer = null;

        /*
         * IDs descartados (por cola llena o timeout).
         * Si su respuesta llega tarde, se ignora.
         */
        this.discardedIds = new Set();
    }

    get isBusy() {
        return this.current !== null;
    }

    processing(event) {

        const id = event?.interactionId ?? null;

        if (id !== null && this.#find(id)) {
            return;
        }

        this.pending.push({
            id,
            processingEvent: event,
            outcome: null
        });

        this.#trimPending();
        this.#advance();
    }

    response(event) {
        this.#settle({
            type: 'response',
            event
        });
    }

    error(event) {
        this.#settle({
            type: 'error',
            event
        });
    }

    /**
     * La voz de esta respuesta empezó y dura durationMs:
     * reemplaza la duración estimada por palabras.
     *
     * Se identifica por el MISMO objeto evento recibido en
     * onSpeaking, así un audio que empieza tarde (después de
     * que la interacción terminó) no afecta a la siguiente.
     */
    speechStarted(event, durationMs) {

        if (
            this.current?.outcome?.type !== 'response' ||
            this.current.outcome.event !== event ||
            !Number.isFinite(durationMs) ||
            durationMs <= 0
        ) {
            return false;
        }

        this.#startTimer(durationMs + this.speechTailMs);

        return true;
    }

    /**
     * Descarta todo lo pendiente (por ejemplo, fin del LIVE).
     */
    reset() {

        this.clearTimer(this.timer);
        this.timer = null;

        const wasBusy = this.isBusy;

        /*
         * Sus resultados pueden seguir llegando del backend;
         * no deben mostrarse después del reset.
         */
        for (const entry of this.#entries()) {
            this.#discard(entry);
        }

        this.current = null;
        this.pending = [];

        if (wasBusy) {
            this.onIdle();
        }
    }

    #settle(outcome) {

        const id = outcome.event?.interactionId ?? null;

        if (id !== null && this.discardedIds.has(id)) {
            return;
        }

        let entry = this.#find(id);

        if (entry?.outcome) {
            return;
        }

        if (!entry) {
            /*
             * Resultado sin ai_processing previo:
             * el overlay se conectó a mitad de una interacción
             * o es un evento de prueba sin interactionId.
             */
            entry = {
                id,
                processingEvent: null,
                outcome: null
            };

            this.pending.push(entry);
        }

        entry.outcome = outcome;

        if (entry === this.current) {
            this.#present(entry);
            return;
        }

        this.#trimPending();
        this.#advance();
    }

    #advance() {

        if (this.current || this.pending.length === 0) {
            return;
        }

        this.current = this.pending.shift();

        if (this.current.outcome) {
            this.#present(this.current);
            return;
        }

        this.onThinking(this.current.processingEvent);
        this.#startTimer(this.thinkingTimeoutMs);
    }

    #present(entry) {

        const { type, event } = entry.outcome;

        if (type === 'response') {
            const durationMs = this.estimateDurationMs(event.text);

            this.onSpeaking(event, durationMs);
            this.#startTimer(durationMs);
            return;
        }

        this.onFailed(event);
        this.#startTimer(this.failureDurationMs);
    }

    #startTimer(ms) {

        this.clearTimer(this.timer);

        this.timer = this.setTimer(() => {
            this.timer = null;
            this.#finishCurrent();
        }, ms);
    }

    #finishCurrent() {

        /*
         * Terminó por timeout de THINKING: su respuesta,
         * si llega después, ya no debe mostrarse.
         */
        if (!this.current.outcome) {
            this.#discard(this.current);
        }

        this.current = null;

        if (this.pending.length === 0) {
            this.onIdle();
            return;
        }

        this.#advance();
    }

    #trimPending() {

        while (this.pending.length > this.maxPending) {
            this.#discard(this.pending.shift());
        }
    }

    #discard(entry) {

        if (entry.id === null) {
            return;
        }

        this.discardedIds.add(entry.id);

        /*
         * Solo necesitamos recordar IDs recientes.
         * Set conserva orden de inserción.
         */
        if (this.discardedIds.size > 100) {
            const [oldest] = this.discardedIds;
            this.discardedIds.delete(oldest);
        }
    }

    /*
     * Con ID: la entrada con ese ID (con o sin resultado).
     * Sin ID: la primera entrada sin ID que aún espera resultado.
     */
    #find(id) {

        return this.#entries().find(
            entry =>
                entry.id === id &&
                (id !== null || !entry.outcome)
        ) ?? null;
    }

    #entries() {

        return this.current
            ? [this.current, ...this.pending]
            : this.pending;
    }
}
