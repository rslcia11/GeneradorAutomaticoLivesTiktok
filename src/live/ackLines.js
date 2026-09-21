/**
 * Lo que dice el mago cuando reconoce algo del público: alguien entra,
 * saluda, comparte el LIVE, deja un like, manda emojis, o ya gastó su
 * lectura del día.
 *
 * Cuándo se dice lo decide el director (`allowAck`), no este archivo.
 *
 * Reglas al escribirlas:
 * - AGRADECER no es PEDIR: nunca "dale like", "comparte", "sígueme".
 * - Tampoco prometer nada a cambio ("eso tiene su recompensa"): eso es
 *   carnada de interacción y TikTok la penaliza igual que pedir.
 * - Sin género: el apodo no dice si es él o ella.
 * - Cortas: se dicen en voz alta mientras pasa otra cosa.
 */

import { GREETINGS } from '../ai/LivenessContent.js';
import { choose, fresh } from './idleLines.js';

/* Alguien entra a la sala. Se saluda por su apodo. */
const MEMBER = GREETINGS;

/* Alguien escribe "hola", "jaja", "gracias"...: relleno con intención. */
const GREETING = Object.freeze([
    u => `Te leo, ${u}. Si traes una duda, escríbela y la vemos.`,
    u => `Hola, ${u}. Aquí ando, con el mazo en la mano.`,
    u => `${u}, qué bueno tenerte. ¿Hay algo que quieras preguntar?`,
    u => `Saludos, ${u}. La mesa está puesta cuando quieras.`,
    u => `${u}, el gato te saluda también. Cuéntame qué te trae.`,
    u => `Te escucho, ${u}. Cuando estés a gusto, pregunta.`,
    u => `${u}, un gusto. Las cartas están despiertas hoy.`,
    u => `Hola, ${u}. ¿Amor, trabajo o dinero? Tú dirás.`
]);

/* Alguien compartió el LIVE. Se agradece sin prometer nada. */
const SHARE = Object.freeze([
    'Alguien llevó el oráculo a otra parte. Gracias, de verdad.',
    'Se abrió una puerta más hacia esta mesa. Gracias por eso.',
    'Gracias por hacer más grande el círculo. El mazo lo nota.',
    'Alguien nos abrió camino. Que las cartas le devuelvan la calma.',
    'Gracias por compartir la noche. Aquí seguimos, leyendo.'
]);

/* Un like, cuando la sala está muy tranquila. */
const LIKE = Object.freeze([
    'Siento el apoyo desde el otro lado de la pantalla. Gracias.',
    'Gracias por acompañar. Esta mesa se siente menos sola así.',
    'Se agradece el gesto. Sigamos con las cartas.',
    'Gracias. El fuego se aviva con la buena compañía.'
]);

/* Comentario de puros emojis: se reacciona a la energía, no al texto. */
const EMOJI = Object.freeze([
    'Esa energía llega fuerte. ¿Hay algo que quieras preguntarle a las cartas?',
    'Las velas parpadearon con eso. ¿Qué traes en el corazón hoy?',
    'El mazo se agitó. ¿Necesitas saber algo?',
    'Buena vibra la tuya. Si tienes una duda, escríbela.',
    'El humo se movió raro con eso. Alguien anda pensando de más.'
]);

/* Ya recibió su lectura gratis de hoy. Se avisa con cariño, sin regatear. */
const QUOTA = Object.freeze([
    u => `${u}, el oráculo ya habló para ti hoy. Mañana el mazo tendrá otro mensaje.`,
    u => `Ya leímos juntos hoy, ${u}. La energía necesita asentarse. Nos vemos mañana.`,
    u => `Por hoy es suficiente, ${u}. Las cartas descansan hasta mañana.`,
    u => `${u}, tu lectura de hoy ya salió. Vuelve mañana y seguimos.`
]);

const BY_KIND = Object.freeze({
    member: MEMBER,
    greeting: GREETING,
    share: SHARE,
    like: LIKE,
    emoji: EMOJI,
    quota: QUOTA
});

/* Sin apodo, a quién se le habla. */
const SIN_NOMBRE = 'viajante';

/**
 * Qué dice el mago para reconocer algo del público.
 *
 * @param {'member'|'greeting'|'share'|'like'|'emoji'|'quota'} kind
 * @param {{ name?: string|null, avoid?: string[] }} context
 *   `name`: apodo de quien lo provocó. `avoid`: lo último que dijo, para
 *   no agradecer dos compartidos seguidos con la misma frase.
 * @returns {string|null} null si el tipo no existe
 */
export function ackLine(kind, { name = null, avoid = [] } = {}, random = Math.random) {

    const pool = BY_KIND[kind];

    if (!pool) {
        return null;
    }

    const said = entry => (typeof entry === 'function' ? entry(name ?? SIN_NOMBRE) : entry);
    const options = pool.map(said);

    return choose(fresh(options, avoid), random);
}

export { EMOJI, GREETING, LIKE, MEMBER, QUOTA, SHARE };
