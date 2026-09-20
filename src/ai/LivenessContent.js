/**
 * Textos pre-escritos para actividad autónoma del avatar.
 * Sin dependencias externas.
 */

export const INVITATIONS = Object.freeze([
    { text: '¿Tienes una pregunta para las cartas? Escríbela en el chat...', intent: 'invite_share' },
    { text: 'Las energías me dicen que alguien necesita una lectura hoy...', intent: 'invite_share' },
    { text: '¿Qué te tiene preocupado? Las cartas pueden mostrarte el camino...', intent: 'invite_share' },
    { text: 'Siento que hay alguien aquí que necesita un mensaje del destino...', intent: 'invite_share' },
    { text: '¿Hay algo que quieras saber sobre tu futuro? Pregúntame...', intent: 'invite_share' },
    { text: 'Los astros están alineados para dar respuestas hoy. ¿Tienes una pregunta?', intent: 'invite_share' },
    { text: 'Las cartas esperan... ¿quién se atreve a preguntar?', intent: 'invite_share' },
    { text: 'Hay una energía poderosa en el aire. ¿Quién tiene una pregunta pendiente?', intent: 'invite_share' },
    { text: 'El universo tiene mensajes para ti. Solo necesitas preguntar...', intent: 'invite_share' },
    { text: '¿Amor, dinero, trabajo? Las cartas lo revelarán todo...', intent: 'invite_share' },
    { text: 'Comenta tu pregunta y las cartas hablarán por ti...', intent: 'invite_share' },
    { text: 'Siento que alguien aquí lleva una carga en el corazón. ¿Quieres que las cartas te ayuden?', intent: 'invite_share' },
    { text: 'Los espíritus del tarot están inquietos... esperan una pregunta...', intent: 'invite_share' },
    { text: '¿Hay algo importante que necesitas saber? Este es el momento...', intent: 'invite_share' },
    { text: 'Las cartas no mienten. ¿Te atreves a conocer la verdad?', intent: 'invite_share' },
]);

export const READINGS = Object.freeze([
    { card: 'El Sol',                    text: 'El Sol ilumina hoy tu camino. La energía positiva fluye a tu alrededor. Es momento de actuar con confianza.',           intent: 'tarot_reading' },
    { card: 'La Luna',                   text: 'La Luna revela que hay cosas ocultas que pronto saldrán a la luz. Confía en tu intuición.',                              intent: 'tarot_reading' },
    { card: 'El Mago',                   text: 'El Mago aparece: tienes todo lo que necesitas para lograr tus metas. La voluntad es tu herramienta más poderosa.',       intent: 'tarot_reading' },
    { card: 'La Emperatriz',             text: 'La Emperatriz trae abundancia y fertilidad. Nuevos comienzos en el área creativa o familiar están por venir.',           intent: 'tarot_reading' },
    { card: 'El Carro',                  text: 'El Carro indica victoria después de un período de lucha. Mantén el control y avanza con determinación.',                 intent: 'tarot_reading' },
    { card: 'La Justicia',               text: 'La Justicia dice que el equilibrio se restaurará. Lo que has sembrado, cosecharás. La verdad prevalecerá.',              intent: 'tarot_reading' },
    { card: 'La Torre',                  text: 'La Torre anuncia un cambio repentino. Lo que se derrumba era necesario que cayera para que algo mejor se construya.',    intent: 'tarot_reading' },
    { card: 'La Estrella',               text: 'La Estrella trae esperanza y renovación. Después de la tormenta, la calma. Hay luz al final del camino.',                intent: 'tarot_reading' },
    { card: 'El Mundo',                  text: 'El Mundo: un ciclo se completa. Has alcanzado un nivel de maestría. Celebra tus logros.',                               intent: 'tarot_reading' },
    { card: 'El Ermitaño',               text: 'El Ermitaño aconseja introspección. La respuesta que buscas está dentro de ti. Busca la soledad para encontrarla.',     intent: 'tarot_reading' },
    { card: 'La Rueda de la Fortuna',    text: 'La Rueda gira. Los cambios que vienen son parte del ciclo natural. Adáptate y fluye con ellos.',                        intent: 'tarot_reading' },
    { card: 'El Loco',                   text: 'El Loco invita a un nuevo comienzo sin miedo. Da el salto de fe. La aventura te espera.',                               intent: 'tarot_reading' },
    { card: 'Los Amantes',               text: 'Los Amantes señalan una decisión importante del corazón. Elige desde el amor, no desde el miedo.',                      intent: 'tarot_reading' },
    { card: 'La Fuerza',                 text: 'La Fuerza: tienes más poder del que crees. La perseverancia suave vence a la fuerza bruta.',                            intent: 'tarot_reading' },
    { card: 'El Sumo Sacerdote',         text: 'El Sumo Sacerdote trae sabiduría tradicional. Busca consejo de alguien con experiencia. La guía espiritual te acompaña.', intent: 'tarot_reading' },
    { card: 'El Diablo',                 text: 'El Diablo advierte: algo te tiene encadenado. Reconoce ese patrón. Tienes el poder de liberarte.',                      intent: 'tarot_reading' },
    { card: 'El Juicio',                 text: 'El Juicio llama al despertar. Es momento de dejar atrás el pasado y responder a un llamado más elevado.',               intent: 'tarot_reading' },
    { card: 'El Emperador',              text: 'El Emperador trae estructura y liderazgo. Es tiempo de tomar el control de tu situación con disciplina.',               intent: 'tarot_reading' },
    { card: 'El Colgado',                text: 'El Colgado pide pausa y reflexión. A veces es necesario ver las cosas desde otro ángulo antes de actuar.',              intent: 'tarot_reading' },
    { card: 'La Templanza',              text: 'La Templanza invita al equilibrio y la paciencia. Mezcla con cuidado los ingredientes de tu vida. La armonía llega.',   intent: 'tarot_reading' },
]);

export const GREETINGS = Object.freeze([
    u => `¡Bienvenido al círculo místico, ${u}! Las cartas te esperaban...`,
    u => `${u} acaba de llegar. ¡Bienvenido! ¿Tienes una pregunta para el tarot?`,
    u => `Las energías se iluminan con tu llegada, ${u}. ¡Bienvenido!`,
    u => `¡${u}! Los astros anunciaron tu visita. ¡Bienvenido al LIVE!`,
    u => `Hola ${u}. Las cartas tienen un mensaje especial para ti hoy...`,
    u => `¡Qué bueno que llegaste, ${u}! Estábamos esperándote.`,
    u => `El universo te trajo aquí, ${u}. ¡Bienvenido!`,
    u => `${u} entra al círculo. ¡Bienvenido, viajero del destino!`,
    u => `¡${u}! Las cartas se mueven al sentir tu presencia.`,
    u => `Bienvenido, ${u}. Aquí las cartas revelan la verdad...`,
    u => `¡Hola ${u}! ¿Listo para descubrir lo que el tarot tiene para ti?`,
    u => `${u} ha llegado. Las energías del día te dan la bienvenida.`,
]);
