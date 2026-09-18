import { createCanvasTexture } from './textures.js';

/**
 * Arte de las cartas, dibujado por código (sin archivos de imagen).
 *
 * Los símbolos se dibujan con paths, NO con glifos de fuente: un "☾" o un
 * "♔" depende de que la máquina del streamer tenga esa fuente instalada y,
 * si no la tiene, en el LIVE se ve un cuadrado vacío. Con paths se ve igual
 * en cualquier PC.
 */

/* Tamaño en la escena; la textura se dibuja al doble para que no pixele. */
export const CARD_WIDTH = 190;
export const CARD_HEIGHT = 316;

const TEXTURE_SCALE = 2;

const GOLD = '#f2d489';
const GOLD_DIM = '#b8893c';
const NIGHT = '#0e0720';

function rgba(hex, alpha) {

    const value = parseInt(hex.slice(1), 16);

    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/* ─── Símbolos ─────────────────────────────────────────────────────────── */

function ring(ctx, radius, width) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
}

function spikes(ctx, points, inner, outer) {

    ctx.beginPath();

    for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;

        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }

    ctx.closePath();
    ctx.fill();
}

/*
 * Un contorno recorrido al revés dentro de otro deja un agujero
 * (regla "nonzero" del canvas): así se hace una luna creciente.
 */
function crescent(ctx, radius, cut, offsetX, offsetY) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2, false);
    ctx.arc(offsetX, offsetY, cut, 0, Math.PI * 2, true);
    ctx.fill();
}

const SYMBOLS = Object.freeze({

    spark(ctx, r) {
        spikes(ctx, 4, r * 0.2, r);

        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.globalAlpha = 0.65;
        spikes(ctx, 4, r * 0.12, r * 0.55);
        ctx.restore();
    },

    wand(ctx, r) {
        ctx.save();
        ctx.rotate(-0.5);
        ctx.fillRect(-r * 0.09, -r * 0.2, r * 0.18, r * 1.2);
        ctx.restore();

        ctx.save();
        ctx.translate(r * 0.42, -r * 0.55);
        spikes(ctx, 5, r * 0.16, r * 0.45);
        ctx.restore();
    },

    moon(ctx, r) {
        crescent(ctx, r, r * 0.88, r * 0.44, -r * 0.16);
    },

    fullMoon(ctx, r) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.25;
        ctx.fillStyle = NIGHT;

        for (const [x, y, size] of [[-0.3, -0.25, 0.22], [0.28, 0.1, 0.3], [-0.1, 0.4, 0.16]]) {
            ctx.beginPath();
            ctx.arc(x * r, y * r, size * r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    },

    venus(ctx, r) {
        ctx.save();
        ctx.translate(0, -r * 0.3);
        ring(ctx, r * 0.55, r * 0.14);
        ctx.restore();

        ctx.fillRect(-r * 0.07, r * 0.25, r * 0.14, r * 0.7);
        ctx.fillRect(-r * 0.32, r * 0.55, r * 0.64, r * 0.14);
    },

    crown(ctx, r) {
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.45);
        ctx.lineTo(-r * 0.78, -r * 0.6);
        ctx.lineTo(-r * 0.34, r * 0.02);
        ctx.lineTo(0, -r * 0.85);
        ctx.lineTo(r * 0.34, r * 0.02);
        ctx.lineTo(r * 0.78, -r * 0.6);
        ctx.lineTo(r, r * 0.45);
        ctx.closePath();
        ctx.fill();

        ctx.fillRect(-r, r * 0.58, r * 2, r * 0.26);
    },

    heart(ctx, r) {
        ctx.beginPath();
        ctx.moveTo(0, r * 0.95);
        ctx.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.55, -r, 0, -r * 0.35);
        ctx.bezierCurveTo(r * 0.55, -r, r * 1.5, -r * 0.1, 0, r * 0.95);
        ctx.closePath();
        ctx.fill();
    },

    infinity(ctx, r) {
        ctx.lineWidth = r * 0.2;

        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(side * r * 0.48, 0, r * 0.45, 0, Math.PI * 2);
            ctx.stroke();
        }
    },

    lantern(ctx, r) {
        ctx.lineWidth = r * 0.14;

        ctx.beginPath();
        ctx.arc(0, -r * 0.75, r * 0.32, Math.PI, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.roundRect(-r * 0.55, -r * 0.5, r * 1.1, r * 1.4, r * 0.18);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(0, r * 0.25, r * 0.22, r * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
    },

    wheel(ctx, r) {
        ring(ctx, r * 0.92, r * 0.16);
        ring(ctx, r * 0.34, r * 0.12);

        ctx.lineWidth = r * 0.1;

        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;

            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * r * 0.34, Math.sin(angle) * r * 0.34);
            ctx.lineTo(Math.cos(angle) * r * 0.92, Math.sin(angle) * r * 0.92);
            ctx.stroke();
        }
    },

    scales(ctx, r) {
        ctx.fillRect(-r * 0.07, -r * 0.8, r * 0.14, r * 1.7);
        ctx.fillRect(-r * 0.4, r * 0.82, r * 0.8, r * 0.14);
        ctx.fillRect(-r * 0.9, -r * 0.86, r * 1.8, r * 0.13);

        ctx.lineWidth = r * 0.09;

        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(side * r * 0.85, -r * 0.8);
            ctx.lineTo(side * r * 0.55, r * 0.1);
            ctx.lineTo(side * r * 1.15, r * 0.1);
            ctx.closePath();
            ctx.stroke();
        }
    },

    star(ctx, r) {
        spikes(ctx, 8, r * 0.36, r);
    },

    sun(ctx, r) {
        ctx.lineWidth = r * 0.1;

        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const reach = i % 2 === 0 ? 1.15 : 0.95;

            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72);
            ctx.lineTo(Math.cos(angle) * r * reach, Math.sin(angle) * r * reach);
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
    },

    world(ctx, r) {
        ring(ctx, r * 0.85, r * 0.13);

        ctx.lineWidth = r * 0.08;

        for (const width of [0.3, 0.6]) {
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.85 * width, r * 0.85, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(-r * 0.85, 0);
        ctx.lineTo(r * 0.85, 0);
        ctx.stroke();
    }
});

/* ─── Los arcanos ──────────────────────────────────────────────────────── */

export const ARCANA = Object.freeze([
    { numeral: 'O', name: 'El Loco', symbol: 'spark', sky: ['#35245e', '#120a26'], accent: '#ffe6a8', tint: 0xffe6a8 },
    { numeral: 'I', name: 'El Mago', symbol: 'wand', sky: ['#3b1c63', '#130a24'], accent: '#d7b3ff', tint: 0xd7b3ff },
    { numeral: 'II', name: 'La Sacerdotisa', symbol: 'moon', sky: ['#1d2a60', '#0b0c24'], accent: '#bcd8ff', tint: 0xbcd8ff },
    { numeral: 'III', name: 'La Emperatriz', symbol: 'venus', sky: ['#4a1f4c', '#1a0a22'], accent: '#ffb7dd', tint: 0xffb7dd },
    { numeral: 'IV', name: 'El Emperador', symbol: 'crown', sky: ['#4d2418', '#1c0c10'], accent: '#ffcf8a', tint: 0xffcf8a },
    { numeral: 'VI', name: 'Los Enamorados', symbol: 'heart', sky: ['#5a1b3c', '#1d0817'], accent: '#ff9ec4', tint: 0xff9ec4 },
    { numeral: 'VIII', name: 'La Fuerza', symbol: 'infinity', sky: ['#4a2a12', '#190d0a'], accent: '#ffd07a', tint: 0xffd07a },
    { numeral: 'IX', name: 'El Ermitaño', symbol: 'lantern', sky: ['#252a4e', '#0c0d1f'], accent: '#ffe9b0', tint: 0xffe9b0 },
    { numeral: 'X', name: 'La Rueda', symbol: 'wheel', sky: ['#143f52', '#06131f'], accent: '#8fe3ff', tint: 0x8fe3ff },
    { numeral: 'XI', name: 'La Justicia', symbol: 'scales', sky: ['#2a2352', '#0d0a21'], accent: '#cfd8ff', tint: 0xcfd8ff },
    { numeral: 'XVII', name: 'La Estrella', symbol: 'star', sky: ['#17395f', '#070f23'], accent: '#a8e6ff', tint: 0xa8e6ff },
    { numeral: 'XVIII', name: 'La Luna', symbol: 'fullMoon', sky: ['#1b2450', '#080a1e'], accent: '#dfe8ff', tint: 0xdfe8ff },
    { numeral: 'XIX', name: 'El Sol', symbol: 'sun', sky: ['#5c3208', '#1d0d06'], accent: '#ffd772', tint: 0xffd772 },
    { numeral: 'XXI', name: 'El Mundo', symbol: 'world', sky: ['#1d4a3b', '#08170f'], accent: '#9ff0c8', tint: 0x9ff0c8 }
]);

/* ─── Composición ──────────────────────────────────────────────────────── */

function cardTexture(draw) {

    return createCanvasTexture(
        CARD_WIDTH * TEXTURE_SCALE,
        CARD_HEIGHT * TEXTURE_SCALE,
        ctx => {
            ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
            draw(ctx, CARD_WIDTH, CARD_HEIGHT);
        }
    );
}

function shape(ctx, w, h, inset, radius) {
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
}

/* Dibuja recortado a la silueta redondeada de la carta. */
function insideCard(ctx, w, h, draw) {
    ctx.save();
    shape(ctx, w, h, 0, 14);
    ctx.clip();
    draw();
    ctx.restore();
}

function starField(ctx, w, h, count, color) {

    ctx.fillStyle = color;

    /*
     * Sembrado fijo (Lehmer): las cartas no deben cambiar entre lecturas.
     * El multiplicador es chico a propósito, así el producto entra exacto
     * en un double y la textura sale idéntica en cualquier máquina.
     */
    let seed = 7;

    const next = () => {
        seed = (seed * 48271) % 2147483647;

        return seed / 2147483647;
    };

    for (let i = 0; i < count; i++) {
        const x = next() * w;
        const y = next() * h;
        const size = 0.6 + (i % 3) * 0.5;

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* Marco dorado doble con diamantes en las esquinas. */
function frame(ctx, w, h) {

    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    shape(ctx, w, h, 7, 11);
    ctx.stroke();

    ctx.strokeStyle = rgba(GOLD_DIM, 0.9);
    ctx.lineWidth = 1.2;
    shape(ctx, w, h, 14, 7);
    ctx.stroke();

    ctx.fillStyle = GOLD;

    for (const [x, y] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
    }
}

/* Texto espaciado a mano: ctx.letterSpacing no existe en todos los runtimes. */
function spacedText(ctx, text, x, y, spacing, maxWidth) {

    const letters = [...text];

    let width = spacing * (letters.length - 1);

    for (const letter of letters) {
        width += ctx.measureText(letter).width;
    }

    const squeeze = maxWidth && width > maxWidth ? maxWidth / width : 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(squeeze, 1);
    ctx.textAlign = 'left';

    let cursor = -width / 2;

    for (const letter of letters) {
        ctx.fillText(letter, cursor, 0);
        cursor += ctx.measureText(letter).width + spacing;
    }

    ctx.restore();
    ctx.textAlign = 'center';
}

export function createFrontTexture(arcana) {

    return cardTexture((ctx, w, h) => {

        const cx = w / 2;
        const cy = h * 0.46;

        insideCard(ctx, w, h, () => {

            const sky = ctx.createLinearGradient(0, 0, 0, h);

            sky.addColorStop(0, arcana.sky[0]);
            sky.addColorStop(1, arcana.sky[1]);

            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, w, h);

            starField(ctx, w, h, 46, rgba('#ffffff', 0.35));

            /* Halo detrás del símbolo: es lo que hace que "irradie". */
            const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.72);

            halo.addColorStop(0, rgba(arcana.accent, 0.5));
            halo.addColorStop(0.5, rgba(arcana.accent, 0.12));
            halo.addColorStop(1, rgba(arcana.accent, 0));

            ctx.fillStyle = halo;
            ctx.fillRect(0, 0, w, h);

            /* Mandala: dos anillos punteados concéntricos. */
            ctx.strokeStyle = rgba(GOLD, 0.45);

            for (const [radius, width] of [[64, 1], [76, 2]]) {
                ctx.lineWidth = width;
                ctx.setLineDash(radius === 64 ? [3, 7] : [1, 12]);
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.setLineDash([]);

            ctx.save();
            ctx.translate(cx, cy);
            ctx.fillStyle = arcana.accent;
            ctx.strokeStyle = arcana.accent;
            ctx.shadowColor = arcana.accent;
            ctx.shadowBlur = 22;
            SYMBOLS[arcana.symbol](ctx, 44);
            ctx.restore();

            /* Cartela del nombre. */
            const banner = ctx.createLinearGradient(0, h - 74, 0, h);

            banner.addColorStop(0, rgba(NIGHT, 0));
            banner.addColorStop(0.45, rgba(NIGHT, 0.85));
            banner.addColorStop(1, rgba(NIGHT, 0.95));

            ctx.fillStyle = banner;
            ctx.fillRect(0, h - 74, w, 74);
        });

        frame(ctx, w, h);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        /* Numeral dentro de un medallón. */
        ctx.fillStyle = rgba(NIGHT, 0.75);
        ctx.beginPath();
        ctx.ellipse(w / 2, 36, 32, 17, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = rgba(GOLD, 0.8);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = GOLD;
        ctx.font = 'bold 15px Georgia, "Times New Roman", serif';
        spacedText(ctx, arcana.numeral, w / 2, 37, 2, 52);

        ctx.fillStyle = GOLD;
        ctx.font = 'bold 14px Georgia, "Times New Roman", serif';
        ctx.shadowColor = rgba(arcana.accent, 0.8);
        ctx.shadowBlur = 10;
        spacedText(ctx, arcana.name.toUpperCase(), w / 2, h - 34, 1.6, w - 40);
        ctx.shadowBlur = 0;

        /* Filete dorado sobre el nombre. */
        ctx.strokeStyle = rgba(GOLD, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w * 0.3, h - 50);
        ctx.lineTo(w * 0.7, h - 50);
        ctx.stroke();
    });
}

export function createBackTexture() {

    return cardTexture((ctx, w, h) => {

        const cx = w / 2;
        const cy = h / 2;

        insideCard(ctx, w, h, () => {

            const background = ctx.createLinearGradient(0, 0, w, h);

            background.addColorStop(0, '#42196d');
            background.addColorStop(0.55, '#26104a');
            background.addColorStop(1, '#100722');

            ctx.fillStyle = background;
            ctx.fillRect(0, 0, w, h);

            starField(ctx, w, h, 60, rgba(GOLD, 0.3));

            /* Rosetón: rayos finos + anillos. */
            ctx.strokeStyle = rgba(GOLD, 0.35);
            ctx.lineWidth = 1;

            for (let i = 0; i < 24; i++) {
                const angle = (i / 24) * Math.PI * 2;

                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(angle) * 30, cy + Math.sin(angle) * 30);
                ctx.lineTo(cx + Math.cos(angle) * 86, cy + Math.sin(angle) * 86);
                ctx.stroke();
            }

            for (const radius of [30, 60, 86]) {
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.stroke();
            }
        });

        /* Luna creciente dorada al centro. */
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = GOLD;
        ctx.shadowColor = rgba(GOLD, 0.9);
        ctx.shadowBlur = 18;
        SYMBOLS.moon(ctx, 25);
        ctx.restore();

        ctx.fillStyle = rgba(GOLD, 0.9);

        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;

            ctx.save();
            ctx.translate(cx + Math.cos(angle) * 104, cy + Math.sin(angle) * 104);
            spikes(ctx, 4, 1.4, i % 2 ? 4 : 6);
            ctx.restore();
        }

        frame(ctx, w, h);
    });
}

/**
 * Banda diagonal de luz que barre la carta.
 *
 * Los bordes quedan transparentes a propósito: al desplazar las UV, Pixi
 * repite el borde (clamp) y así la banda entra y sale sin cortes.
 */
export function createSheenTexture() {

    return cardTexture((ctx, w, h) => {
        const sheen = ctx.createLinearGradient(w * 0.24, 0, w * 0.76, h);

        sheen.addColorStop(0, rgba('#ffffff', 0));
        sheen.addColorStop(0.42, rgba('#ffffff', 0));
        sheen.addColorStop(0.5, rgba('#ffffff', 0.85));
        sheen.addColorStop(0.58, rgba('#ffffff', 0));
        sheen.addColorStop(1, rgba('#ffffff', 0));

        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, w, h);
    });
}

/* Haz de luz vertical que baja sobre la carta que se está revelando. */
export function createBeamTexture(width = 256, height = 512) {

    return createCanvasTexture(width, height, ctx => {

        /*
         * Fila por fila: cada una es un degradé horizontal que se apaga
         * hacia los costados, así el cono no tiene NINGÚN borde duro.
         * Se dibuja una sola vez al arrancar.
         */
        for (let y = 0; y < height; y++) {

            const v = y / (height - 1);

            /* Cono: angosto arriba, ancho abajo. */
            const half = width * (0.1 + 0.38 * v);

            /* Entra suave arriba, máximo a 3/4 y se apaga antes del final. */
            const strength = Math.sin(Math.PI * Math.min(1, v / 0.75) * 0.5) *
                Math.min(1, (1 - v) / 0.2);

            const row = ctx.createLinearGradient(width / 2 - half, 0, width / 2 + half, 0);

            row.addColorStop(0, rgba('#ffffff', 0));
            row.addColorStop(0.5, rgba('#ffffff', 0.9 * strength));
            row.addColorStop(1, rgba('#ffffff', 0));

            ctx.fillStyle = row;
            ctx.fillRect(width / 2 - half, y, half * 2, 1);
        }
    });
}
