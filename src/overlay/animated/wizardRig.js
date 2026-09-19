/**
 * Anatomía del mago sobre assets/tarot-character.png.
 *
 * Coordenadas en píxeles de la textura original (981 × 1602).
 * Si cambia la imagen, solo hay que ajustar este archivo.
 * Para verlas dibujadas: overlay con ?avatar=animado&debug=anchors
 *
 * baseOnly: la zona solo coincide con la imagen base (en las poses
 * las manos y los ojos están en otro lugar), así que ese deformador
 * se atenúa según cuánto se ve la base.
 */

export const TEXTURE_SIZE = Object.freeze({
    width: 981,
    height: 1602
});

export const ANCHORS = Object.freeze({
    aura: { x: 490, y: 540 },

    ball: { x: 515, y: 855, radius: 138 },

    eyes: [
        { x: 460, y: 338 },
        { x: 526, y: 336 }
    ],

    cards: [
        { x: 200, y: 1138 },
        { x: 335, y: 1172 },
        { x: 505, y: 1188 },
        { x: 645, y: 1172 },
        { x: 780, y: 1150 }
    ],

    hands: [
        { x: 365, y: 755 },
        { x: 705, y: 805 }
    ],

    /* Punta de la llama de cada vela (origen del humo). */
    candles: [
        { x: 912, y: 910 },  /* vela derecha */
        { x: 185, y: 790 }   /* humo/incienso izquierdo */
    ],

    /* Donde flota la carta durante una lectura de tarot (una sola, centrada). */
    readingSlots: [
        { x: 515, y: 1118, rotation: 0 }
    ],

    /* Las 5 cartas que se ven sobre la mesa en la imagen base. */
    tableSlots: [
        { x: 200, y: 1138, rotation: -0.32 },
        { x: 335, y: 1172, rotation: -0.16 },
        { x: 505, y: 1188, rotation:  0    },
        { x: 645, y: 1172, rotation:  0.16 },
        { x: 780, y: 1150, rotation:  0.32 }
    ]
});

/*
 * Zonas que NUNCA se deforman: la bola de cristal,
 * su base y todo lo que está sobre/bajo la mesa.
 */
export const PINS = Object.freeze([
    { cx: 515, cy: 855, rx: 150, ry: 150, soft: 0.12 },
    { cx: 518, cy: 1020, rx: 140, ry: 80, soft: 0.2 },
    { belowY: 1075, soft: 18 }
]);

export const DEFORMERS = Object.freeze([
    {
        name: 'breath',
        kind: 'scale',
        pivot: { x: 490, y: 1060 },
        area: { cx: 490, cy: 620, rx: 430, ry: 580 },
        gate: { above: 1040, soft: 40 }
    },
    {
        name: 'head',
        kind: 'rotate',
        pivot: { x: 490, y: 500 },
        area: { cx: 490, cy: 280, rx: 340, ry: 390 },
        gate: { above: 540, soft: 60 }
    },
    {
        name: 'hatTip',
        kind: 'translate',
        area: { cx: 295, cy: 160, rx: 130, ry: 150 }
    },
    {
        /* Solo lo que está debajo de la boca: "abre" la mandíbula. */
        name: 'jaw',
        kind: 'translate',
        area: { cx: 490, cy: 560, rx: 165, ry: 205 },
        gate: { below: 418, soft: 14 }
    },
    {
        name: 'beard',
        kind: 'translate',
        area: { cx: 492, cy: 620, rx: 150, ry: 110 }
    },
    {
        name: 'blinkLeft',
        baseOnly: true,
        kind: 'squash',
        pivot: { x: 460, y: 338 },
        area: { cx: 460, cy: 338, rx: 30, ry: 18 }
    },
    {
        name: 'blinkRight',
        baseOnly: true,
        kind: 'squash',
        pivot: { x: 526, y: 336 },
        area: { cx: 526, cy: 336, rx: 30, ry: 18 }
    },
    {
        name: 'handLeft',
        baseOnly: true,
        kind: 'translate',
        area: { cx: 365, cy: 755, rx: 120, ry: 100 }
    },
    {
        name: 'handRight',
        baseOnly: true,
        kind: 'translate',
        area: { cx: 705, cy: 805, rx: 115, ry: 110 }
    },
    {
        name: 'catHead',
        kind: 'rotate',
        pivot: { x: 850, y: 860 },
        area: { cx: 850, cy: 765, rx: 95, ry: 95 }
    },
    {
        name: 'catEar',
        kind: 'rotate',
        pivot: { x: 812, y: 738 },
        area: { cx: 800, cy: 705, rx: 32, ry: 36 }
    },
    {
        name: 'flame',
        kind: 'scale',
        pivot: { x: 912, y: 975 },
        area: { cx: 912, cy: 948, rx: 22, ry: 40 }
    },
    {
        name: 'smoke',
        kind: 'translate',
        area: { cx: 185, cy: 840, rx: 45, ry: 90 }
    }
]);
