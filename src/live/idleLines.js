/**
 * Lo que dice el mago cuando nadie pregunta. Sin IA: son plantillas, así
 * no gastan cuota y nunca fallan.
 *
 * Reglas al escribirlas:
 * - NUNCA pedir regalos ni decir "sígueme", "comparte", "dale like":
 *   TikTok penaliza repetir llamados a la acción.
 * - Invitar a preguntar, que es lo que mueve el LIVE.
 * - Variedad real: si suenan iguales, parecen un script automático.
 *
 * Además de invitar, el mago puede saludar a alguien que acaba de entrar
 * o hacer una "carta del día" (lectura corta sin destinatario, con cartas
 * en pantalla): así la escena cambia aunque nadie escriba.
 */

import { GREETINGS, INVITATIONS, READINGS } from '../ai/LivenessContent.js';

const QUIET = [
    'Las cartas están inquietas esta noche... ¿alguien se anima a preguntar?',
    'Pregunta lo que traes en el pecho y las cartas responden.',
    'El humo del incienso dibuja un nombre... quizá el tuyo. Escribe tu pregunta.',
    'Hay una energía dando vueltas en esta sala. ¿Quién quiere que la lea?',
    'La bola de cristal está tibia; eso pasa cuando alguien duda de algo importante.',
    'Amor, trabajo o dinero: escribe tu pregunta y vemos qué dicen los arcanos.',
    'Escucho pasos en el umbral... hay alguien con una pregunta atorada.',
    'Un arcano se asomó solo del mazo. Alguien aquí necesita respuesta.',
    'La primera pregunta del día no cuesta nada. Solo escríbela.',
    'El gato negro se acomodó junto a la bola: buena señal para preguntar.',
    ...INVITATIONS.map(entry => entry.text)
];

const WARMING = [
    'Vamos con calma, una pregunta a la vez. ¿Quién sigue?',
    'Veo gente nueva en la sala. Si traes una duda, escríbela.',
    'Las velas se avivan cuando llega alguien con una pregunta de verdad.',
    'Cuéntame qué te quita el sueño y busco tu carta.',
    'Deja tu pregunta en el chat; las cartas no tienen prisa, pero la noche sí.',
    'Bienvenidos los que acaban de llegar. Aquí se pregunta y se responde.'
];

const BUSY = [
    'Voy leyendo en orden, no se me pierde nadie.',
    'Tranquilos, el mazo alcanza para todos.',
    'Sigo aquí, carta por carta.'
];

const BY_MOOD = Object.freeze({ quiet: QUIET, warming: WARMING, busy: BUSY });

/* Con qué frecuencia, en vez de invitar, hace otra cosa. */
const READING_CHANCE = Object.freeze({ quiet: 0.3, warming: 0.2, busy: 0 });
const GREETING_CHANCE = Object.freeze({ quiet: 0.35, warming: 0.5, busy: 0 });

const choose = (options, random) =>
    options[Math.min(Math.floor(random() * options.length), options.length - 1)];

const fresh = (pool, avoid) => {
    const unused = pool.filter(text => !avoid.includes(text));

    return unused.length > 0 ? unused : pool;
};

/**
 * Qué dice el mago ahora.
 *
 * @param {{ mood: string, avoid?: string[], newcomer?: string|null }} context
 *   `newcomer` es el apodo de alguien que acaba de entrar (para saludarlo).
 * @param {() => number} random
 * @returns {{ text: string, intent: 'invite_share'|'tarot_reading' }}
 */
export function idleLine({ mood = 'quiet', avoid = [], newcomer = null } = {}, random = Math.random) {

    const known = BY_MOOD[mood] ? mood : 'quiet';
    const roll = random();

    /* Sin recién llegado, la franja del saludo no existe. */
    const greetingChance = newcomer ? GREETING_CHANCE[known] : 0;

    if (roll < greetingChance) {
        return { text: choose(GREETINGS, random)(newcomer), intent: 'invite_share' };
    }

    if (roll < greetingChance + READING_CHANCE[known]) {
        /* El texto ya nombra la carta ("El Sol ilumina..."): no se repite. */
        const options = fresh(READINGS.map(entry => entry.text), avoid);

        return { text: choose(options, random), intent: 'tarot_reading' };
    }

    return { text: choose(fresh(BY_MOOD[known], avoid), random), intent: 'invite_share' };
}

export { QUIET, WARMING, BUSY };
