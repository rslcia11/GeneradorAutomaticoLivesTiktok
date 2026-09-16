const WS_URL = 'ws://localhost:8080';

const elements = {
    connectionStatus: document.getElementById('connection-status'),
    likeCount: document.getElementById('like-count'),
    viewerCount: document.getElementById('viewer-count'),

    avatar: document.getElementById('avatar'),
    avatarExpression: document.getElementById('avatar-expression'),
    avatarStatus: document.getElementById('avatar-status'),

    commentUser: document.getElementById('comment-user'),
    commentContent: document.getElementById('comment-content'),

    notification: document.getElementById('event-notification')
};

let socket = null;
let reconnectTimer = null;
let notificationTimer = null;
let reactionTimer = null;

function connect() {
    clearTimeout(reconnectTimer);

    elements.connectionStatus.textContent = 'Conectando...';

    socket = new WebSocket(WS_URL);

    socket.addEventListener('open', () => {
        console.log('WebSocket conectado');

        elements.connectionStatus.textContent = '🟢 LIVE conectado';
    });

    socket.addEventListener('message', message => {
        try {
            const event = JSON.parse(message.data);

            handleEvent(event);
        } catch (error) {
            console.error('Evento WebSocket inválido:', error);
        }
    });

    socket.addEventListener('close', () => {
        console.warn('WebSocket desconectado');

        elements.connectionStatus.textContent = '🔴 Desconectado';

        scheduleReconnect();
    });

    socket.addEventListener('error', error => {
        console.error('Error WebSocket:', error);
    });
}

function scheduleReconnect() {
    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
        connect();
    }, 3000);
}

function handleEvent(event) {
    if (!event || typeof event.type !== 'string') {
        return;
    }

    switch (event.type) {

        case 'system':
            break;

        case 'comment':
            handleComment(event);
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

        // MEMBER genera mucho tráfico.
        // Lo recibimos, pero por ahora no altera la escena.
        case 'member':
            break;

        default:
            console.debug('Evento sin manejador:', event);
    }
}

function handleComment(event) {
    const username =
        event.user?.nickname ||
        event.user?.username ||
        'Usuario';

    const content = event.content?.trim();

    if (!content) {
        return;
    }

    elements.commentUser.textContent = username;
    elements.commentContent.textContent = content;

    elements.avatarStatus.textContent = 'Nuevo comentario';

    reactAvatar('●ᴗ●');
}

function handleGift(event) {
    const username =
        event.user?.nickname ||
        event.user?.username ||
        'Usuario';

    const giftName =
        event.gift?.name ||
        'regalo';

    /*
     * Los regalos combo pueden producir varios eventos.
     * Para la escena solo notificamos cuando termina el combo.
     */
    if (
        event.gift?.combo === true &&
        Number(event.gift?.repeatEnd) !== 1
    ) {
        return;
    }

    const quantity =
        Number(event.gift?.repeatCount) || 1;

    showNotification(
        `🎁 ${username} envió ${giftName} ×${quantity}`
    );

    elements.avatarStatus.textContent =
        `¡Gracias por el regalo, ${username}!`;

    reactAvatar('★‿★', 1800);
}

function handleLike(event) {
    if (event.like?.total !== undefined) {
        elements.likeCount.textContent =
            formatNumber(event.like.total);
    }
}

function handleFollow(event) {
    const username =
        event.user?.nickname ||
        event.user?.username ||
        'Nuevo seguidor';

    showNotification(
        `➕ ${username} empezó a seguir`
    );

    elements.avatarStatus.textContent =
        `¡Bienvenido, ${username}!`;

    reactAvatar('●ᴗ●');
}

function handleShare(event) {
    const username =
        event.user?.nickname ||
        event.user?.username ||
        'Usuario';

    showNotification(
        `🔄 ${username} compartió el LIVE`
    );

    reactAvatar('◕‿◕');
}

function handleRoomUser(event) {
    if (event.room?.viewers !== undefined) {
        elements.viewerCount.textContent =
            formatNumber(event.room.viewers);
    }
}

function handleSubscription(event) {
    const username =
        event.user?.nickname ||
        event.user?.username ||
        'Usuario';

    showNotification(
        `⭐ ${username} se suscribió`
    );

    elements.avatarStatus.textContent =
        `¡Gracias por suscribirte, ${username}!`;

    reactAvatar('★ᴗ★', 2000);
}

function handleStreamEnd() {
    elements.connectionStatus.textContent =
        '⚫ LIVE finalizado';

    elements.avatarStatus.textContent =
        'La transmisión ha terminado';

    showNotification('LIVE finalizado');
}

function showNotification(text) {
    clearTimeout(notificationTimer);

    elements.notification.classList.remove('visible');

    /*
     * Fuerza el reinicio de la animación CSS cuando
     * llegan dos notificaciones consecutivas.
     */
    void elements.notification.offsetWidth;

    elements.notification.textContent = text;
    elements.notification.classList.add('visible');

    notificationTimer = setTimeout(() => {
        elements.notification.classList.remove('visible');
    }, 2500);
}

function reactAvatar(expression, duration = 900) {
    clearTimeout(reactionTimer);

    elements.avatarExpression.textContent = expression;
    elements.avatar.classList.add('reacting');

    reactionTimer = setTimeout(() => {
        elements.avatarExpression.textContent = '●‿●';
        elements.avatar.classList.remove('reacting');
        elements.avatarStatus.textContent =
            'Esperando interacción...';
    }, duration);
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return String(value);
    }

    return new Intl.NumberFormat('es-EC').format(number);
}

connect();