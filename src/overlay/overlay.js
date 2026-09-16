import { TarotAvatar } from './TarotAvatar.js';
import { InteractionPresenter } from './InteractionPresenter.js';

const WS_URL = 'ws://localhost:8080';

const elements = {
    connectionStatus:
        document.getElementById('connection-status'),

    likeCount:
        document.getElementById('like-count'),

    viewerCount:
        document.getElementById('viewer-count'),

    avatar:
        document.getElementById('avatar'),

    avatarImage:
        document.getElementById('avatar-image'),

    avatarStatus:
        document.getElementById('avatar-status'),

    commentUser:
        document.getElementById('comment-user'),

    commentContent:
        document.getElementById('comment-content'),

    notification:
        document.getElementById('event-notification')
};

validateRequiredElements();

const avatar = new TarotAvatar({
    root: elements.avatar,
    image: elements.avatarImage,
    statusElement: elements.avatarStatus
});

/*
 * Presenta las interacciones de IA de una en una.
 * Mientras está ocupado, nada interrumpe al avatar.
 */
const presenter = new InteractionPresenter({
    estimateDurationMs: text =>
        avatar.estimateSpeechDuration(text),

    onThinking: showThinking,
    onSpeaking: showResponse,
    onFailed: showFailure,

    onIdle: () => {
        avatar.idle();
    }
});

let socket = null;

let reconnectTimer = null;
let notificationTimer = null;

let reconnectAttempt = 0;

let manuallyClosed = false;

const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 10000;


/* ============================================================
   VALIDACIÓN DOM
   ============================================================ */

function validateRequiredElements() {

    const required = [
        'connectionStatus',
        'likeCount',
        'viewerCount',
        'avatar',
        'avatarImage',
        'avatarStatus',
        'commentUser',
        'commentContent',
        'notification'
    ];

    const missing = required.filter(
        key => !elements[key]
    );

    if (missing.length > 0) {
        throw new Error(
            `Overlay incompleto. Faltan elementos: ${missing.join(', ')}`
        );
    }
}


/* ============================================================
   WEBSOCKET
   ============================================================ */

function connect() {

    if (manuallyClosed) {
        return;
    }

    clearTimeout(reconnectTimer);

    /*
     * Evita crear conexiones paralelas.
     */
    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    setConnectionState(
        'connecting',
        'Conectando...'
    );

    socket = new WebSocket(WS_URL);

    socket.addEventListener(
        'open',
        handleSocketOpen
    );

    socket.addEventListener(
        'message',
        handleSocketMessage
    );

    socket.addEventListener(
        'close',
        handleSocketClose
    );

    socket.addEventListener(
        'error',
        handleSocketError
    );
}

function handleSocketOpen() {

    console.log(
        'WebSocket conectado'
    );

    reconnectAttempt = 0;

    setConnectionState(
        'connected',
        '🟢 LIVE conectado'
    );
}

function handleSocketMessage(message) {

    let event;

    try {
        event = JSON.parse(
            message.data
        );
    } catch (error) {

        console.error(
            'Evento WebSocket inválido:',
            error
        );

        return;
    }

    handleEvent(event);
}

function handleSocketClose() {

    console.warn(
        'WebSocket desconectado'
    );

    socket = null;

    setConnectionState(
        'disconnected',
        '🔴 Desconectado'
    );

    if (!manuallyClosed) {
        scheduleReconnect();
    }
}

function handleSocketError(error) {

    /*
     * El evento "close" será quien gestione
     * la reconexión.
     */
    console.error(
        'Error WebSocket:',
        error
    );
}

function scheduleReconnect() {

    clearTimeout(reconnectTimer);

    reconnectAttempt += 1;

    const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS *
            (2 ** Math.min(
                reconnectAttempt - 1,
                3
            ))
    );

    reconnectTimer = setTimeout(
        connect,
        delay
    );
}

function setConnectionState(
    state,
    text
) {

    elements.connectionStatus.dataset.state =
        state;

    elements.connectionStatus.textContent =
        text;
}


/* ============================================================
   ROUTER DE EVENTOS
   ============================================================ */

function handleEvent(event) {

    if (
        !event ||
        typeof event !== 'object' ||
        typeof event.type !== 'string'
    ) {
        console.warn(
            'Evento ignorado por contrato inválido:',
            event
        );

        return;
    }

    switch (event.type) {

        case 'system':
            handleSystem(event);
            break;

        case 'comment':
            handleComment(event);
            break;

        case 'ai_processing':
            presenter.processing(event);
            break;

        case 'ai_response':
            handleAIResponse(event);
            break;

        case 'ai_error':
            presenter.error(event);
            break;

        case 'gift':
            handleGift(event);
            break;

        case 'like':
            handleLike(event);
            break;

        case 'follow':
            handleFollow(event);
            break;

        case 'share':
            handleShare(event);
            break;

        case 'room_user':
            handleRoomUser(event);
            break;

        case 'subscription':
            handleSubscription(event);
            break;

        case 'stream_end':
            handleStreamEnd();
            break;

        /*
         * MEMBER produce mucho tráfico.
         * Se conserva en transporte pero no altera
         * la escena.
         */
        case 'member':
            break;

        default:
            console.debug(
                'Evento sin manejador:',
                event
            );
    }
}


/* ============================================================
   SYSTEM
   ============================================================ */

function handleSystem(event) {

    if (
        typeof event.message === 'string' &&
        event.message.trim()
    ) {
        console.debug(
            'Sistema:',
            event.message
        );
    }
}


/* ============================================================
   COMMENT
   ============================================================ */

function handleComment(event) {

    const username =
        getDisplayName(event.user);

    const content =
        normalizeText(event.content);

    if (!content) {
        return;
    }

    /*
     * Mientras se presenta una interacción de IA,
     * los comentarios nuevos esperan en la cola del
     * backend y se mostrarán cuando les toque
     * (ai_processing). Si los pintáramos aquí,
     * taparían la respuesta en curso.
     */
    if (presenter.isBusy) {
        return;
    }

    elements.commentUser.textContent =
        username;

    elements.commentContent.textContent =
        content;

    avatar.listen(username);
}


/* ============================================================
   AI — PROCESSING
   ============================================================ */

function showThinking(event) {

    const username =
        getDisplayName(event?.user);

    const content =
        normalizeText(event?.source?.content);

    /*
     * Mostramos el comentario que realmente se está
     * respondiendo, no el último que llegó.
     */
    if (content) {
        elements.commentUser.textContent =
            username;

        elements.commentContent.textContent =
            content;
    }

    avatar.think();

    elements.avatarStatus.textContent =
        `Consultando las cartas para ${username}...`;
}


/* ============================================================
   AI — RESPONSE
   ============================================================ */

function handleAIResponse(event) {

    if (!normalizeText(event.text)) {
        console.warn(
            'Respuesta de IA vacía tratada como error'
        );

        /*
         * Se trata como error para que la interacción
         * termine y no bloquee a las siguientes.
         */
        presenter.error(event);

        return;
    }

    presenter.response(event);
}

function showResponse(event) {

    const text =
        normalizeText(event.text);

    const username =
        getDisplayName(event.user);

    elements.commentUser.textContent =
        `🔮 Respuesta para ${username}`;

    elements.commentContent.textContent =
        text;

    /*
     * La duración la controla InteractionPresenter
     * (estimada según cantidad de palabras).
     *
     * Cuando integremos TTS, el fin del audio
     * deberá marcar el fin de la interacción.
     */
    avatar.startSpeaking();

    console.log(
        'Respuesta IA recibida:',
        {
            user: username,
            text,
            provider:
                event.ai?.provider ?? null,
            model:
                event.ai?.model ?? null,
            fallbackUsed:
                event.ai?.fallbackUsed ?? false
        }
    );
}


/* ============================================================
   AI — ERROR
   ============================================================ */

function showFailure(event) {

    const username =
        getDisplayName(event?.user);

    showNotification(
        `No pude responder a ${username}`
    );

    /*
     * Sin avatar.react(): la duración del fallo la
     * controla InteractionPresenter, no un timer propio.
     */
    avatar.setState(
        TarotAvatar.STATES.REACTING,
        {
            status:
                'La energía se interrumpió...'
        }
    );
}


/* ============================================================
   REACCIONES
   ============================================================ */

/*
 * Regalos, follows, shares y suscripciones siempre
 * muestran su notificación, pero no interrumpen al
 * avatar mientras presenta una interacción de IA.
 */
function reactIfFree(options) {

    if (presenter.isBusy) {
        return;
    }

    avatar.react(options);
}


/* ============================================================
   GIFTS
   ============================================================ */

function handleGift(event) {

    const username =
        getDisplayName(event.user);

    const giftName =
        normalizeText(
            event.gift?.name
        ) || 'regalo';

    /*
     * TikTok puede emitir varios eventos durante
     * un combo. Visualmente reaccionamos al cierre
     * del combo para evitar spam.
     */
    if (
        event.gift?.combo === true &&
        Number(
            event.gift?.repeatEnd
        ) !== 1
    ) {
        return;
    }

    const quantity =
        positiveInteger(
            event.gift?.repeatCount,
            1
        );

    showNotification(
        `🎁 ${username} envió ${giftName} ×${quantity}`
    );

    reactIfFree({
        status:
            `¡Gracias por el regalo, ${username}!`,
        durationMs: 2200
    });
}


/* ============================================================
   LIKE
   ============================================================ */

function handleLike(event) {

    if (
        event.like?.total === undefined ||
        event.like?.total === null
    ) {
        return;
    }

    elements.likeCount.textContent =
        formatNumber(
            event.like.total
        );
}


/* ============================================================
   FOLLOW
   ============================================================ */

function handleFollow(event) {

    const username =
        getDisplayName(event.user);

    showNotification(
        `➕ ${username} empezó a seguir`
    );

    reactIfFree({
        status:
            `¡Bienvenido, ${username}!`,
        durationMs: 1700
    });
}


/* ============================================================
   SHARE
   ============================================================ */

function handleShare(event) {

    const username =
        getDisplayName(event.user);

    showNotification(
        `🔄 ${username} compartió el LIVE`
    );

    reactIfFree({
        status:
            `¡Gracias por compartir, ${username}!`,
        durationMs: 1500
    });
}


/* ============================================================
   ROOM USER
   ============================================================ */

function handleRoomUser(event) {

    if (
        event.room?.viewers === undefined ||
        event.room?.viewers === null
    ) {
        return;
    }

    elements.viewerCount.textContent =
        formatNumber(
            event.room.viewers
        );
}


/* ============================================================
   SUBSCRIPTION
   ============================================================ */

function handleSubscription(event) {

    const username =
        getDisplayName(event.user);

    showNotification(
        `⭐ ${username} se suscribió`
    );

    reactIfFree({
        status:
            `¡Gracias por suscribirte, ${username}!`,
        durationMs: 2600
    });
}


/* ============================================================
   STREAM END
   ============================================================ */

function handleStreamEnd() {

    setConnectionState(
        'ended',
        '⚫ LIVE finalizado'
    );

    showNotification(
        'LIVE finalizado'
    );

    presenter.reset();

    avatar.setState(
        TarotAvatar.STATES.IDLE,
        {
            status:
                'La transmisión ha terminado'
        }
    );
}


/* ============================================================
   NOTIFICACIONES
   ============================================================ */

function showNotification(text) {

    const normalized =
        normalizeText(text);

    if (!normalized) {
        return;
    }

    clearTimeout(
        notificationTimer
    );

    elements.notification.classList.remove(
        'visible'
    );

    /*
     * Reinicia la animación CSS si llegan
     * notificaciones consecutivas.
     */
    void elements.notification.offsetWidth;

    elements.notification.textContent =
        normalized;

    elements.notification.classList.add(
        'visible'
    );

    notificationTimer = setTimeout(
        () => {
            elements.notification.classList.remove(
                'visible'
            );
        },
        2500
    );
}


/* ============================================================
   HELPERS
   ============================================================ */

function getDisplayName(user) {

    return (
        normalizeText(
            user?.nickname
        ) ||
        normalizeText(
            user?.username
        ) ||
        'Usuario'
    );
}

function normalizeText(value) {

    if (
        typeof value !== 'string'
    ) {
        return '';
    }

    return value.trim();
}

function positiveInteger(
    value,
    fallback
) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return fallback;
    }

    return Math.max(
        1,
        Math.floor(number)
    );
}

function formatNumber(value) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return String(value);
    }

    return new Intl.NumberFormat(
        'es-EC'
    ).format(number);
}


/* ============================================================
   CLEANUP
   ============================================================ */

function shutdownOverlay() {

    manuallyClosed = true;

    clearTimeout(
        reconnectTimer
    );

    clearTimeout(
        notificationTimer
    );

    presenter.reset();

    avatar.destroy();

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        socket.close();
    }

    socket = null;
}

window.addEventListener(
    'beforeunload',
    shutdownOverlay
);


/* ============================================================
   START
   ============================================================ */

connect();