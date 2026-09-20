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

    /* Mago que habla solo, como persona: no todo es un llamado a escribir. */
    'Mmm... el mazo pesa distinto hoy. Alguien anda cargando algo que no dice.',
    'A veces la sala está callada porque la pregunta da miedo. Escrita da menos miedo, te lo aseguro.',
    'Yo aquí, con mi té y mis cartas. Cuando quieras, preguntas.',
    'La vela de la izquierda parpadea. Cuando hace eso, alguien está pensando en un nombre.',
    'No hace falta contarme toda la historia. Con una palabra las cartas ya saben por dónde ir.',
    'Voy a barajar mientras esperamos. El sonido de las cartas calma hasta al gato.',
    'Tengo un arcano boca abajo que no quiere dejarme verlo. Debe ser de alguien que aún no escribe.',
    'Si estás leyendo esto en silencio, ya me estás preguntando algo. Solo falta que lo escribas.',
    'Dicen que la medianoche es la mejor hora; yo digo que la mejor hora es cuando te animas.',
    'El incienso ya va a la mitad. Todavía alcanza para un par de respuestas.',
    '¿Ese silencio es de tranquilidad o de nervios? Por si acaso, aquí estoy.',
    'Ninguna pregunta es tonta en esta mesa. Tontas son las dudas que se quedan sin salir.',
    'Hoy amanecí con la Estrella en la mano. Buen presagio para quien pregunte primero.',
    'Cuéntame en dos palabras qué te anda rondando y yo pongo el resto.',
    'El gato bostezó. O la sala está muy tranquila, o alguien está por escribir.',
    'Estoy viendo una inicial en el humo... no alcanzo a leerla completa. ¿Es la tuya?',
    'No se preocupen por el mago viejo; he esperado noches enteras. Pero una preguntita no estaría mal.',
    'Se dice que cuando el fuego chasquea, alguien lejos piensa en ti. Acaba de chasquear.',
    ...INVITATIONS.map(entry => entry.text)
];

const WARMING = [
    'Vamos con calma, una pregunta a la vez. ¿Quién sigue?',
    'Veo gente nueva en la sala. Si traes una duda, escríbela.',
    'Las velas se avivan cuando llega alguien con una pregunta de verdad.',
    'Cuéntame qué te quita el sueño y busco tu carta.',
    'Deja tu pregunta en el chat; las cartas no tienen prisa, pero la noche sí.',
    'Saludos a quienes acaban de llegar. Aquí se pregunta y se responde.',
    'Ya somos varios. Bien. Quien tenga la pregunta más urgente, que la escriba primero.',
    'Noto que están leyendo callados. Está bien, pero la pregunta escrita es la que tiene respuesta.',
    'Voy a encender otra vela; con más gente, más luz hace falta.',
    'Mientras alguien se anima, barajo. Que el mazo no se enfríe.',
    'Quien pregunta primero se lleva la carta más fresca. Es una superstición mía, pero funciona.',
    'Hola a quienes van entrando. Sin prisa: aquí el tiempo corre distinto.',
    'Siento varias energías en la sala y una que pide turno. ¿Quién es?',
    'Si alguien vino por curiosidad, que se quede: la curiosidad también se lee.',
    'Qué bonito cuando la sala se va llenando de a poquito. Como el té: mejor sin apuro.',
    'Un consejo del mago viejo: pregunten lo que de verdad importa, no lo que suena bonito.'
];

const BUSY = [
    'Voy leyendo en orden, no se me pierde nadie.',
    'Tranquilos, el mazo alcanza para todos.',
    'Sigo aquí, carta por carta.',
    'Qué noche movida. Me gusta.',
    'Paciencia, que las cartas también necesitan respirar entre lectura y lectura.',
    'Con este ritmo se me va a acabar el incienso antes que las respuestas.',
    'Uno a uno, con calma. Nadie sale de aquí sin su carta.'
];

const BY_MOOD = Object.freeze({ quiet: QUIET, warming: WARMING, busy: BUSY });

/* Con qué frecuencia, en vez de invitar, hace otra cosa. */
const READING_CHANCE = Object.freeze({ quiet: 0.3, warming: 0.2, busy: 0 });
const GREETING_CHANCE = Object.freeze({ quiet: 0.35, warming: 0.5, busy: 0 });

const choose = (options, random) =>
    options[Math.min(Math.floor(random() * options.length), options.length - 1)];

/*
 * Frases que todavía no se usaron. Si el catálogo es más corto que la
 * memoria del director (BUSY son pocas), ya no queda ninguna "fresca":
 * ahí se recicla la más vieja, no la última ni la anteúltima. Si no,
 * el mago hace ping-pong entre dos frases y se nota muchísimo.
 */
const fresh = (pool, avoid) => {
    const unused = pool.filter(text => !avoid.includes(text));

    if (unused.length > 0) {
        return unused;
    }

    /* Se protegen tantas recientes como quepan dejando al menos una libre. */
    const protegidas = pool.length - 1;
    const recientes = new Set(protegidas > 0 ? avoid.slice(-protegidas) : []);

    return pool.filter(text => !recientes.has(text));
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
