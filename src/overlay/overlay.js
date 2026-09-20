import { TarotAvatar } from './TarotAvatar.js';
import { InteractionPresenter } from './InteractionPresenter.js';
import { SpeechPlayer } from './SpeechPlayer.js';
import { Hud } from './hud.js';
import { formatNumber } from './format.js';
import { startDebugTools } from './debugTools.js';
import { fitStage } from './stage.js';
import { socketUrl } from './socketUrl.js';
import { AmbientAudio } from './AmbientAudio.js';

/* Primero el escenario: todo lo demás se mide dentro de él. */
fitStage();

/* Mismo servidor que sirvió la página, ruta `ws`, con la clave de la URL. */
const WS_URL = socketUrl(window.location);

/* Grados de hue-rotate por paleta de atuendo (5 paletas, índice 0–4). */
const OUTFIT_HUES = Object.freeze([0, -60, 80, 140, 160]);

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
        document.getElementById('event-notification'),

    serviceMenu:
        document.getElementById('service-menu'),

    serviceMenuList:
        document.getElementById('service-menu-list'),

    donorBoard:
        document.getElementById('donor-board'),

    donorBoardList:
        document.getElementById('donor-board-list'),

    contactBanner:
        document.getElementById('contact-banner'),

    responseBar:
        document.getElementById('response-bar'),

    responseBarUser:
        document.getElementById('response-bar-user'),

    responseBarText:
        document.getElementById('response-bar-text'),

    cardSpotlight:
        document.getElementById('card-spotlight'),

    cardSpotlightName:
        document.getElementById('card-spotlight-name'),

    promoBanner:
        document.getElementById('promo-banner'),

    serviceMenuTimer:
        document.getElementById('service-menu-timer-time')
};

validateRequiredElements();

const avatar = new TarotAvatar({
    root: elements.avatar,
    image: elements.avatarImage,
    statusElement: elements.avatarStatus
});

/*
 * Voz de las respuestas. El navegador puede bloquear el audio
 * hasta el primer clic/tecla (en OBS no pasa).
 */
const speech = new SpeechPlayer();

/*
 * Música ambiental + efectos de sonido.
 * Coloca tu archivo en: src/overlay/assets/audio/ambient.mp3
 */
const ambient = new AmbientAudio();

/* Menú de servicios, últimos en apoyar y franja de contacto. */
const hud = new Hud({ elements });

/*
 * Respuesta cuya voz controla la boca. Mientras exista, la boca
 * sigue SOLO el volumen real (0 al cargar y en la pausa final),
 * nunca el ritmo sintético.
 */
let voicedResponse = null;
let followingSpeechLevel = false;

for (const gesture of ['pointerdown', 'keydown']) {
    window.addEventListener(gesture, () => {
        speech.unlock();
        ambient.unlock();
    });
}

/* En OBS el audio arranca inmediatamente sin necesitar gesto. */
ambient.unlock();

/* Toda fase nueva de una interacción empieza cortando la voz anterior. */
const afterStoppingSpeech = callback => (...args) => {
    speech.stop();
    voicedResponse = null;
    return callback(...args);
};

/*
 * Presenta las interacciones de IA de una en una.
 * Mientras está ocupado, nada interrumpe al avatar.
 */
const presenter = new InteractionPresenter({
    estimateDurationMs: text =>
        avatar.estimateSpeechDuration(text),

    onThinking: afterStoppingSpeech(showThinking),
    onSpeaking: afterStoppingSpeech(showResponse),
    onFailed: afterStoppingSpeech(showFailure),
    onIdle: afterStoppingSpeech(() => {
        avatar.idle();
        if (elements.responseBar) {
            elements.responseBar.hidden = true;
        }
    })
});

/*
 * ?avatar=animado  → renderer WebGL (PixiJS)
 * ?debug=1         → métricas de rendimiento + teclas de prueba
 * ?debug=anchors   → además dibuja las zonas del rig
 * ?fps=30          → limita los FPS del avatar animado
 * ?preview=estado  → ver debugTools.js
 */
const overlayParams =
    new URLSearchParams(window.location.search);

let animatedAvatar = null;

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

    /* Paneles del HUD (menú, donantes, contacto). */
    if (hud.handle(event)) {
        return;
    }

    switch (event.type) {

        case 'system':
            handleSystem(event);
            break;

        case 'comment':
            handleComment(event);
            break;

        case 'queue_position':
            handleQueuePosition(event);
            break;

        /* Cuánta vida pide el director de sala (más si nadie comenta). */
        case 'scene_mood':
            animatedAvatar?.setEnergy(event.energy);
            document.body.dataset.mood = event.mood ?? '';
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

        case 'outfit_change':
            handleOutfitChange(event);
            break;

        case 'avatar_shuffle':
            handleAvatarShuffle();
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
   QUEUE POSITION
   ============================================================ */

function handleQueuePosition(event) {

    const username = getDisplayName(event.user);
    const pos = positiveInteger(event.position, 0);

    if (!pos) {
        return;
    }

    showNotification(
        `✨ ${username} en la fila — Puesto #${pos}`
    );
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
    ambient.playEffect('thinking');

    elements.avatarStatus.textContent = isIdleLine(event)
        ? 'El mago observa la sala...'
        : `Consultando las cartas para ${username}...`;
}

/* Frase que el mago dice solo (director de sala): no responde a nadie. */
const isIdleLine = event => event?.source?.type === 'idle';


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

    const idle = isIdleLine(event);

    elements.commentUser.textContent = idle
        ? '🔮 El mago'
        : `🔮 Respuesta para ${username}`;

    elements.commentContent.textContent =
        text;

    if (elements.responseBar) {
        elements.responseBarUser.textContent = idle
            ? 'El mago dice'
            : `Respondiendo a ${username}`;
        elements.responseBarText.textContent = text;
        elements.responseBar.hidden = false;
    }

    /*
     * La duración la controla InteractionPresenter: estimada por
     * palabras y, si hay voz, la duración real del audio.
     */
    avatar.startSpeaking({
        intent: event.intent ?? null
    });

    ambient.playEffect('speaking');
    playSpeech(event);

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


function playSpeech(event) {

    if (!event.audio) {
        return;
    }

    voicedResponse = event;
    followSpeechLevel();

    speech.play(event.audio)
        .then(result => {
            /* null: se pidió otra cosa mientras cargaba. */
            if (result) {
                presenter.speechStarted(event, result.durationMs);
            }
        })
        .catch(error => {
            /*
             * Sin voz: la respuesta sigue con la duración estimada
             * y la boca vuelve al ritmo sintético.
             */
            if (voicedResponse === event) {
                voicedResponse = null;
            }

            console.warn(
                'Voz no reproducida:',
                error.code ?? error.message
            );
        });
}

/* Boca del avatar animado = volumen real de la voz, cuadro a cuadro. */
function followSpeechLevel() {

    if (followingSpeechLevel) {
        return;
    }

    followingSpeechLevel = true;

    const step = () => {
        if (!voicedResponse) {
            followingSpeechLevel = false;
            return;
        }

        animatedAvatar?.setSpeechLevel(speech.level);
        requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
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
 * celebran (efecto visual superpuesto), pero solo
 * cambian el estado del avatar si no está presentando
 * una interacción de IA, para no cortar la respuesta.
 */
function reactToAudience(kind, options) {

    avatar.celebrate(kind);

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

    ambient.playEffect('gift');

    reactToAudience('gift', {
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

    ambient.playEffect('follow');

    reactToAudience('follow', {
        status:
            `¡Un gusto, ${username}!`,
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

    ambient.playEffect('share');

    reactToAudience('share', {
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

    ambient.playEffect('subscription');

    reactToAudience('subscription', {
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
   OUTFIT CHANGE
   ============================================================ */

function handleOutfitChange(event) {

    const id = typeof event.paletteId === 'number'
        ? Math.max(0, Math.min(4, Math.floor(event.paletteId)))
        : 0;

    const hue = OUTFIT_HUES[id] ?? 0;

    animatedAvatar?.setOutfit(id);
    avatar.setHueShift(hue);
}


/* ============================================================
   AVATAR SHUFFLE
   ============================================================ */

function handleAvatarShuffle() {

    if (!presenter.isBusy) {
        avatar.idle();
    }
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

    clearTimeout(
        cardSpotlightTimer
    );

    presenter.reset();
    speech.destroy();
    hud.destroy();

    animatedAvatar?.destroy();
    animatedAvatar = null;

    ambient.destroy();
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
   CARD SPOTLIGHT
   ============================================================ */

let cardSpotlightTimer = null;

function showCardSpotlight(cardName) {

    if (!elements.cardSpotlight || !cardName) {
        return;
    }

    clearTimeout(cardSpotlightTimer);

    elements.cardSpotlightName.textContent = cardName;
    elements.cardSpotlight.hidden = false;
    elements.cardSpotlight.classList.add('card-spotlight--visible');

    cardSpotlightTimer = setTimeout(() => {
        elements.cardSpotlight.classList.remove('card-spotlight--visible');
        cardSpotlightTimer = setTimeout(() => {
            elements.cardSpotlight.hidden = true;
        }, 500);
    }, 2800);
}


/* ============================================================
   AVATAR ANIMADO (PixiJS)
   ============================================================ */

async function startAnimatedAvatar() {

    try {
        /*
         * Import dinámico: en modo CSS no se descarga PixiJS.
         */
        const { AnimatedAvatar } =
            await import('./animated/AnimatedAvatar.js');

        animatedAvatar = await AnimatedAvatar.create({
            root: elements.avatar,
            imageUrl: elements.avatarImage.src,
            initialState: avatar.state,
            initialIntent: avatar.intent,
            maxFPS: Number(overlayParams.get('fps')) || 60,
            debug: overlayParams.get('debug'),
            onCardReveal: showCardSpotlight
        });

        console.log('Avatar animado activo');

        /* Acceso desde DevTools para ajustar el rig en vivo. */
        if (overlayParams.has('debug')) {
            window.animatedAvatar = animatedAvatar;
        }

    } catch (error) {
        console.error(
            'Avatar animado no disponible; se mantiene el avatar CSS:',
            error
        );
    }
}


/* ============================================================
   START
   ============================================================ */

connect();

/* ?debug: permite simular eventos del backend desde DevTools. */
if (overlayParams.has('debug')) {
    window.overlayDebug = { handleEvent };
}

/*
 * El avatar animado carga en paralelo: la conexión al LIVE
 * no espera a PixiJS. Hasta que esté listo se ve el avatar CSS.
 * Usa ?avatar=css para forzar el modo sin WebGL.
 */
const animatedAvatarReady =
    overlayParams.get('avatar') !== 'css'
        ? startAnimatedAvatar()
        : Promise.resolve();

void animatedAvatarReady.then(() => {
    startDebugTools({
        avatar,
        params: overlayParams
    });
});

if (overlayParams.has('demo')) {
    setTimeout(() => {
        hud.showServices([
            { label: 'Pregunta Rapida',    coins: 270, icon: '🍩', style: 'short' },
            { label: 'Lectura 3 Cartas',   coins: 200, icon: '🌌', style: 'reading' },
            { label: 'Prioridad 5 Cartas', coins: 0,   icon: '🦊', style: 'full' },
            { label: 'Prioridad 3 Cartas', coins: 0,   icon: '🎩', style: 'reading_long' }
        ]);
    }, 1500);
}