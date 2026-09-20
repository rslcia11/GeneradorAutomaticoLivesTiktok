/**
 * TarotAvatar
 *
 * Controlador visual del avatar del LIVE.
 *
 * Responsabilidades:
 * - Administrar estados visuales.
 * - Controlar animaciones mediante clases CSS.
 * - Permitir reacciones temporales.
 * - Preparar el avatar para futura integración TTS.
 *
 * NO administra:
 * - WebSocket.
 * - TikTok.
 * - Gemini.
 * - Comentarios.
 * - Likes/viewers.
 */
export class TarotAvatar {

    static STATES = Object.freeze({
        IDLE: 'idle',
        LISTENING: 'listening',
        THINKING: 'thinking',
        SPEAKING: 'speaking',
        REACTING: 'reacting'
    });

    constructor({
        root,
        image,
        statusElement = null
    } = {}) {

        if (!(root instanceof HTMLElement)) {
            throw new Error(
                'TarotAvatar requiere un elemento root válido'
            );
        }

        if (!(image instanceof HTMLImageElement)) {
            throw new Error(
                'TarotAvatar requiere una imagen válida'
            );
        }

        this.root = root;
        this.image = image;
        this.statusElement = statusElement;

        this.state = null;
        this.intent = null;

        this.reactionTimer = null;
        this.speakingTimer = null;

        this.destroyed = false;

        /*
         * Permite detectar movimiento reducido configurado
         * por el usuario/navegador.
         */
        this.reducedMotionQuery =
            window.matchMedia(
                '(prefers-reduced-motion: reduce)'
            );

        this.setState(
            TarotAvatar.STATES.IDLE,
            {
                status: 'Esperando interacción...'
            }
        );
    }

    /**
     * Cambia el estado principal del avatar.
     */
    setState(
        state,
        {
            status = null,
            intent = null
        } = {}
    ) {

        if (this.destroyed) {
            return;
        }

        if (
            !Object.values(TarotAvatar.STATES)
                .includes(state)
        ) {
            throw new Error(
                `Estado de avatar inválido: ${state}`
            );
        }

        /*
         * Un timer solo existe para terminar el estado
         * que lo creó. Si no se cancela aquí, puede
         * devolver a IDLE un estado posterior
         * (por ejemplo, THINKING en plena consulta).
         */
        this.#clearTimers();

        /*
         * Quitamos únicamente clases administradas
         * por este controlador.
         */
        for (
            const avatarState
            of Object.values(TarotAvatar.STATES)
        ) {
            this.root.classList.remove(
                `avatar--${avatarState}`
            );
        }

        this.state = state;
        this.intent = intent;

        this.root.dataset.avatarState = state;

        this.root.classList.add(
            `avatar--${state}`
        );

        if (
            status !== null &&
            this.statusElement
        ) {
            this.statusElement.textContent =
                status;
        }

        this.root.dispatchEvent(
            new CustomEvent(
                'avatarstatechange',
                {
                    detail: {
                        state,

                        /*
                         * Tipo de respuesta (tarot_reading, thanks,
                         * comment, invite_share) para elegir gestos.
                         */
                        intent
                    }
                }
            )
        );
    }

    /**
     * Usuario acaba de interactuar.
     */
    listen(username = null) {

        const status = username
            ? `Escuchando a ${username}...`
            : 'Escuchando...';

        this.setState(
            TarotAvatar.STATES.LISTENING,
            { status }
        );
    }

    /**
     * Gemini está generando una respuesta.
     */
    think() {

        this.setState(
            TarotAvatar.STATES.THINKING,
            {
                status: 'Consultando las cartas...'
            }
        );
    }

    /**
     * Estado preparado para TTS.
     *
     * Actualmente puede utilizar una duración estimada.
     * Más adelante startSpeaking()/stopSpeaking() serán
     * controlados por eventos reales del motor de audio.
     */
    startSpeaking({
        durationMs = null,
        intent = null
    } = {}) {

        this.setState(
            TarotAvatar.STATES.SPEAKING,
            {
                status: 'Respondiendo...',
                intent
            }
        );

        if (
            Number.isFinite(durationMs) &&
            durationMs > 0
        ) {
            this.speakingTimer = setTimeout(
                () => {
                    this.stopSpeaking();
                },
                durationMs
            );
        }
    }

    /**
     * Finaliza el estado speaking.
     */
    stopSpeaking() {

        this.idle();
    }

    /**
     * Reacción temporal para regalos, follows,
     * suscripciones, etc.
     */
    react({
        status = '¡Gracias!',
        durationMs = 1800
    } = {}) {

        this.setState(
            TarotAvatar.STATES.REACTING,
            {
                status
            }
        );

        this.reactionTimer = setTimeout(
            () => {
                this.idle();
            },
            Math.max(0, durationMs)
        );
    }

    /**
     * Celebración visual (regalo, follow, share, suscripción).
     *
     * NO cambia el estado: se superpone a lo que el avatar
     * esté haciendo, sin cortar una respuesta en curso.
     * La dibuja el renderer animado (?avatar=animado).
     */
    celebrate(kind = 'gift') {

        if (this.destroyed) {
            return;
        }

        this.root.dispatchEvent(
            new CustomEvent(
                'avatarcelebrate',
                {
                    detail: {
                        kind
                    }
                }
            )
        );
    }

    /**
     * Regresa al estado base.
     */
    idle() {

        this.setState(
            TarotAvatar.STATES.IDLE,
            {
                status: 'Esperando interacción...'
            }
        );
    }

    setHueShift(deg) {

        if (this.destroyed) {
            return;
        }

        this.image.style.transition = 'filter 1.5s ease';
        this.image.style.filter     = deg === 0 ? '' : `hue-rotate(${deg}deg)`;
    }

    /**
     * Estimación temporal provisional para representar
     * visualmente una respuesta mientras aún no existe TTS.
     *
     * NO será necesaria cuando tengamos duración real
     * proporcionada por audio.
     */
    estimateSpeechDuration(text) {

        if (
            typeof text !== 'string' ||
            !text.trim()
        ) {
            return 1200;
        }

        const words =
            text
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .length;

        /*
         * Aproximación visual:
         * ~165 palabras/minuto.
         */
        const estimated =
            (words / 165) * 60_000;

        return Math.min(
            12_000,
            Math.max(
                1800,
                Math.round(estimated)
            )
        );
    }

    /**
     * Limpieza del controlador.
     */
    destroy() {

        this.#clearTimers();

        for (
            const avatarState
            of Object.values(TarotAvatar.STATES)
        ) {
            this.root.classList.remove(
                `avatar--${avatarState}`
            );
        }

        delete this.root.dataset.avatarState;

        this.destroyed = true;
    }

    #clearTimers() {

        clearTimeout(this.reactionTimer);
        clearTimeout(this.speakingTimer);

        this.reactionTimer = null;
        this.speakingTimer = null;
    }
}