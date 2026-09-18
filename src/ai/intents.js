/**
 * Intención de una respuesta del avatar.
 *
 * El overlay la usa para elegir la animación:
 * solo las lecturas de tarot mueven las cartas.
 */
export const INTENT = Object.freeze({
    TAROT_READING: 'tarot_reading',
    THANKS: 'thanks',
    COMMENT: 'comment',
    INVITE_SHARE: 'invite_share'
});

export const INTENTS = Object.freeze(Object.values(INTENT));

/**
 * Regalos y suscripciones siempre son agradecimientos, diga lo
 * que diga el modelo. Para el resto se acepta la intención del
 * modelo si es válida; si no, es un comentario.
 */
export function resolveIntent(event, modelIntent) {

    if (event?.type === 'gift' || event?.type === 'subscription') {
        return INTENT.THANKS;
    }

    return INTENTS.includes(modelIntent)
        ? modelIntent
        : INTENT.COMMENT;
}

/**
 * Lo que la persona pagó manda sobre lo que el modelo clasificó:
 *
 * - servicio con cartas  → siempre salen las cartas,
 * - servicio sin cartas  → nunca salen (una respuesta corta gratis
 *   no debe verse como una lectura completa).
 *
 * Los agradecimientos no se tocan: un regalo siempre agradece.
 */
export function applyServiceIntent(intent, service) {

    if (!service || intent === INTENT.THANKS) {
        return intent;
    }

    if (service.cards) {
        return INTENT.TAROT_READING;
    }

    return intent === INTENT.TAROT_READING
        ? INTENT.COMMENT
        : intent;
}
