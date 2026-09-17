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
