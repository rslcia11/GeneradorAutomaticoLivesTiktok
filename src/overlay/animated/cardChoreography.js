/**
 * Coreografía de las cartas de tarot.
 *
 * Decide DÓNDE está cada carta en cada instante; no sabe nada de Pixi ni
 * del DOM. Esa separación es a propósito: la animación es la parte que más
 * se retoca "a ojo" y así se puede probar sin navegador.
 *
 * Acto por acto:
 *   summon  → salen de la bola girando y caen en su lugar, boca abajo
 *   shuffle → giran en un carrusel 3D (las de atrás se oscurecen)
 *   reveal  → una a una: se acercan a cámara, voltean, estallan
 *   hover   → flotan con parallax y un barrido de brillo mientras habla
 *   dismiss → giran y se hunden de vuelta en la bola
 */

import { isMirrored } from './cardGeometry.js';

export const TIMING = Object.freeze({
    summon: 0.85,
    summonStagger: 0.13,

    shuffle: 1.35,

    reveal: 0.8,
    revealStagger: 0.5,

    dismiss: 0.8
});

/* Radio del carrusel del barajado (x mucho más ancho que y: es una elipse). */
const ORBIT = Object.freeze({ x: 235, y: 52 });

/* Altura del arco al salir de la bola y al volver. */
const SUMMON_ARC = 130;
const DISMISS_ARC = 45;

/* Cuánto se acerca la carta a la cámara en su momento de gloria. */
const HERO_SCALE = 0.42;
const HERO_LIFT = 62;

/* Barrido de brillo: cada cuánto y cuánto dura. */
const SHEEN_EVERY_S = 5;
const SHEEN_S = 0.75;

/* Resplandor de una carta en reposo; los actos suman sobre esto. */
const REST_GLOW = 0.28;

/* Lo que se funde al terminar la revelación (el resto ya coincide). */
const SETTLE_KEYS = Object.freeze(['y', 'rotation', 'spinY', 'tilt', 'scale', 'glow']);

export const NEXT_PHASE = Object.freeze({
    summon: 'shuffle',
    shuffle: 'reveal',
    reveal: 'hover',
    dismiss: 'hidden'
});

const clamp01 = value => Math.min(1, Math.max(0, value));
const lerp = (from, to, t) => from + (to - from) * t;

const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeInCubic = t => t ** 3;
const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;

function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;

    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/* Campana 0 → 1 → 0. */
const arc = p => Math.sin(Math.PI * clamp01(p));

/* Pico angosto alrededor de `center`: el fogonazo del volteo. */
const spike = (p, center, width) => Math.exp(-(((p - center) / width) ** 2));

/**
 * Cuánto dura una fase completa (la última carta incluida).
 * 'hover' no termina sola: dura hasta que el mago deja de hablar.
 */
export function phaseDuration(phase, count = 3) {

    switch (phase) {

        case 'summon':
            return TIMING.summon + TIMING.summonStagger * (count - 1);

        case 'shuffle':
            return TIMING.shuffle;

        case 'reveal':
            return TIMING.reveal + TIMING.revealStagger * (count - 1);

        case 'dismiss':
            return TIMING.dismiss;

        default:
            return Infinity;
    }
}

/* Progreso 0..1 de UNA carta dentro de la fase (respetando su retraso). */
export function cardProgress(phase, time, index) {

    switch (phase) {

        case 'summon':
            return clamp01((time - index * TIMING.summonStagger) / TIMING.summon);

        case 'reveal':
            return clamp01((time - index * TIMING.revealStagger) / TIMING.reveal);

        case 'shuffle':
            return clamp01(time / TIMING.shuffle);

        case 'dismiss':
            return clamp01(time / TIMING.dismiss);

        default:
            return 0;
    }
}

/* Oscurecimiento del fondo: la atención tiene que ir a las cartas. */
export function scrimTarget(phase) {

    switch (phase) {
        case 'shuffle': return 0.14;
        case 'reveal': return 0.34;
        case 'hover': return 0.2;
        default: return 0;
    }
}

function base(slot) {
    return {
        x: slot.x,
        y: slot.y,
        rotation: slot.rotation,
        scale: 1,
        alpha: 1,

        /* Giro sobre el eje vertical: 0 = dorso, π = cara. */
        spinY: 0,
        tilt: 0,

        /* -1 atrás, +1 adelante; ordena el dibujo y apaga las de atrás. */
        depth: 0,
        shade: 1,

        glow: REST_GLOW,
        beam: 0,
        flash: 0,

        /* Posición del barrido de brillo, o -1 si no hay. */
        sheen: -1,

        faceUp: false
    };
}

function summon(card, p, origin, slot, index) {

    const e = easeOutBack(p);

    card.x = lerp(origin.x, slot.x, e);
    card.y = lerp(origin.y, slot.y, e) - arc(p) * SUMMON_ARC;
    card.rotation = lerp(-0.55 + index * 0.25, slot.rotation, e);
    card.scale = lerp(0.12, 1, easeOutCubic(p));
    card.alpha = clamp01(p * 4);

    /* Dos vueltas completas que frenan justo al aterrizar. */
    card.spinY = (1 - easeOutCubic(p)) * Math.PI * 4;
    card.glow = REST_GLOW * easeOutCubic(p) + 0.45 * arc(p);
}

function shuffle(card, p, slot, index, count) {

    /* Cada carta arranca en un punto distinto de la elipse. */
    const start = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const angle = start + easeInOutSine(p) * Math.PI * 2;

    /* Restar el punto de partida garantiza que empieza y termina en su lugar. */
    card.x = slot.x + (Math.cos(angle) - Math.cos(start)) * ORBIT.x;
    card.y = slot.y + (Math.sin(angle) - Math.sin(start)) * ORBIT.y;

    /*
     * La profundidad entra y sale con el acto: en los extremos vale 0, así
     * el barajado empalma sin saltos con el acto anterior y el siguiente.
     */
    const depth = Math.sin(angle) * arc(p);

    card.depth = depth;
    card.scale = 1 + depth * 0.14;
    card.shade = 1 - 0.32 * Math.max(0, -depth);

    /* Las cartas "banquean" al girar, como naipes en una mano. */
    card.spinY = -depth * 0.5;
    card.tilt = Math.cos(angle) * 0.12 * arc(p);

    card.rotation = slot.rotation + Math.sin(Math.PI * 2 * p) * 0.22;
    card.glow = REST_GLOW + 0.2 * arc(p);
}

function reveal(card, p, slot, index, clock, talk) {

    /*
     * La carta que ya se reveló no se queda congelada esperando a las
     * otras: pasa a flotar enseguida, con el mismo reloj que usará el
     * acto siguiente para que el empalme no se note.
     */
    if (p >= 1) {
        hover(card, clock, slot, index, talk);

        return;
    }

    /* El volteo ocurre en el centro del acto, no al principio. */
    const flip = clamp01((p - 0.12) / 0.5);

    card.spinY = Math.PI * easeInOutSine(flip);
    card.faceUp = isMirrored(card.spinY);

    const hero = arc(clamp01(p / 0.92));

    card.scale = 1 + HERO_SCALE * hero;
    card.y = slot.y - HERO_LIFT * hero;

    /* Se endereza mientras está en primer plano: se lee mejor. */
    card.rotation = lerp(slot.rotation, 0, hero);

    card.depth = hero;
    card.glow = 0.35 + 0.65 * hero;
    card.beam = clamp01(p / 0.22) * (1 - clamp01((p - 0.78) / 0.22));
    card.flash = spike(p, 0.42, 0.06);

    /* Apenas se ve la cara, un brillo la recorre. */
    card.sheen = p > 0.55 ? clamp01((p - 0.55) / 0.35) : -1;

    /*
     * Último cuarto: se funde con la pose de flotar, así en p = 1 ya ES esa
     * pose y el paso a flotar no da ningún salto.
     */
    const settle = easeInOutSine(clamp01((p - 0.75) / 0.25));

    if (settle > 0) {
        const rest = base(slot);

        hover(rest, clock, slot, index, talk);

        for (const key of SETTLE_KEYS) {
            card[key] = lerp(card[key], rest[key], settle);
        }
    }
}

function hover(card, clock, slot, index, talk) {

    card.y = slot.y + Math.sin(clock * 1.5 + index * 2) * 7 - talk * 5;
    card.rotation = slot.rotation + Math.sin(clock * 1.05 + index) * 0.025;

    /* π = cara a cámara; la oscilación hace que la luz la recorra. */
    card.spinY = Math.PI + Math.sin(clock * 0.9 + index * 1.3) * 0.17;
    card.tilt = Math.cos(clock * 0.7 + index) * 0.07;

    card.faceUp = true;
    card.scale = 1 + talk * 0.03;
    card.glow = REST_GLOW + 0.04 + 0.14 * Math.sin(clock * 2.3 + index) + talk * 0.25;

    const cycle = (clock + index * 1.7) % SHEEN_EVERY_S;

    card.sheen = cycle < SHEEN_S ? cycle / SHEEN_S : -1;
}

function dismiss(card, p, origin, from) {

    const e = easeInCubic(p);

    card.x = lerp(from.x, origin.x, e);
    card.y = lerp(from.y, origin.y, e) - arc(p) * DISMISS_ARC;
    card.rotation = from.rotation + e * 2.4;
    card.scale = lerp(from.scale, 0.08, e);
    card.alpha = from.alpha * (1 - p * p);

    /* Giro rápido desde donde estaba: la cara se esconde antes de desaparecer. */
    card.spinY = (from.spinY ?? Math.PI) + e * Math.PI * 3;

    /*
     * Si la lectura se cortó antes de revelar esta carta, se va boca abajo:
     * cerrar nunca puede destapar (ni festejar) una carta.
     */
    card.faceUp = (from.faceUp ?? true) && isMirrored(card.spinY);
    card.glow = 0.5 * (1 - p);
}

/**
 * Estado completo de una carta en un instante.
 *
 * `time`  se reinicia en cada acto; `clock` corre desde que empezó la
 *         lectura y es el que gobierna el flotar, para que el cambio de
 *         acto no produzca un salto en la oscilación.
 * `from`  solo hace falta en 'dismiss': es dónde estaba la carta cuando se
 *         pidió cerrar la lectura, para que salga desde ahí y no de un salto.
 */
export function cardTransform({
    phase,
    time,
    clock = time,
    index,
    count = 3,
    slot,
    origin,
    from = null,
    talk = 0
}) {

    const card = base(slot);
    const p = cardProgress(phase, time, index);

    switch (phase) {

        case 'summon':
            summon(card, p, origin, slot, index);
            break;

        case 'shuffle':
            shuffle(card, p, slot, index, count);
            break;

        case 'reveal':
            reveal(card, p, slot, index, clock, talk);
            break;

        case 'hover':
            hover(card, clock, slot, index, talk);
            break;

        case 'dismiss':
            dismiss(card, p, origin, from ?? base(slot));
            break;
    }

    return card;
}
