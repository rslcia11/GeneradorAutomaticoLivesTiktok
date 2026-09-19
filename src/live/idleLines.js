/**
 * Lo que dice el mago cuando nadie pregunta. Sin IA: son plantillas, así
 * no gastan cuota y nunca fallan.
 *
 * Reglas al escribirlas:
 * - NUNCA pedir regalos ni decir "sígueme", "comparte", "dale like":
 *   TikTok penaliza repetir llamados a la acción.
 * - Invitar a preguntar, que es lo que mueve el LIVE.
 * - Variedad real: si suenan iguales, parecen un script automático.
 */

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
    'El gato negro se acomodó junto a la bola: buena señal para preguntar.'
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

/**
 * Elige una frase para el ánimo de la sala, evitando las últimas usadas.
 *
 * @param {{ mood: string, avoid?: string[] }} context
 * @param {() => number} random
 */
export function idleLine({ mood = 'quiet', avoid = [] } = {}, random = Math.random) {

    const pool = BY_MOOD[mood] ?? QUIET;
    const fresh = pool.filter(line => !avoid.includes(line));
    const options = fresh.length > 0 ? fresh : pool;

    return options[Math.min(Math.floor(random() * options.length), options.length - 1)];
}

export { QUIET, WARMING, BUSY };
