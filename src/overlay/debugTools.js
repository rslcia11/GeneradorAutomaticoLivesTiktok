/**
 * Herramientas de prueba del overlay.
 *
 * ?preview=acción → ejecuta una acción al cargar (claves de `actions`)
 * ?debug=1        → además habilita teclas:
 *                   1 reposo · 2 escuchando · 3 pensando · 4 hablando (comentario)
 *                   5 reaccionando · 6 lectura de tarot · 7 agradeciendo
 *                   8 invitando a compartir · g regalo
 */

const DEBUG_KEYS = Object.freeze({
    1: 'idle',
    2: 'listening',
    3: 'thinking',
    4: 'speaking',
    5: 'reacting',
    6: 'tarot',
    7: 'thanks',
    8: 'invite',
    g: 'gift'
});

export function startDebugTools({ avatar, params }) {

    const actions = {
        idle: () => avatar.idle(),
        listening: () => avatar.listen('Vista previa'),
        thinking: () => avatar.think(),
        speaking: () => avatar.startSpeaking({ intent: 'comment' }),
        tarot: () => avatar.startSpeaking({ intent: 'tarot_reading' }),
        thanks: () => avatar.startSpeaking({ intent: 'thanks' }),
        invite: () => avatar.startSpeaking({ intent: 'invite_share' }),
        reacting: () => avatar.react({ durationMs: 60_000 }),
        gift: () => avatar.celebrate('gift')
    };

    actions[params.get('preview')]?.();

    if (!params.has('debug')) {
        return;
    }

    window.addEventListener('keydown', event => {
        actions[DEBUG_KEYS[event.key]]?.();
    });
}
