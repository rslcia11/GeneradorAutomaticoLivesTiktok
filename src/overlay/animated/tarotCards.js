import { Container, Sprite } from '../vendor/pixi-8.20.1.min.mjs';
import { createCanvasTexture } from './textures.js';

/**
 * Cartas de tarot mágicas para las lecturas.
 *
 * Solo aparecen cuando el avatar responde una pregunta de tarot:
 * salen de la bola → se barajan en el aire → se revelan una a una
 * → flotan mientras habla → vuelven a la bola al terminar.
 *
 * Todas las cartas se dibujan por código (canvas), sin assets.
 */

const ARCANA = Object.freeze([
    ['0', 'El Loco', '✧'],
    ['I', 'El Mago', '✦'],
    ['II', 'La Sacerdotisa', '☾'],
    ['III', 'La Emperatriz', '♀'],
    ['IV', 'El Emperador', '♔'],
    ['VI', 'Los Enamorados', '♥'],
    ['VIII', 'La Fuerza', '∞'],
    ['IX', 'El Ermitaño', '✺'],
    ['X', 'La Rueda', '☸'],
    ['XI', 'La Justicia', '⚖'],
    ['XVII', 'La Estrella', '★'],
    ['XVIII', 'La Luna', '☽'],
    ['XIX', 'El Sol', '☀'],
    ['XXI', 'El Mundo', '◎']
]);

/* Tamaño en píxeles de la escena; la textura se dibuja al doble. */
const CARD_WIDTH = 150;
const CARD_HEIGHT = 250;
const TEXTURE_SCALE = 2;

/* Escala del sprite para mostrar la textura (doble tamaño) a CARD_WIDTH. */
const FACE_SCALE = 1 / TEXTURE_SCALE;

const SUMMON_S = 0.8;
const SUMMON_STAGGER_S = 0.12;
const SHUFFLE_S = 1.4;
const FLIP_S = 0.5;
const FLIP_STAGGER_S = 0.4;
const DISMISS_S = 0.7;

/* Ángulo inicial de cada carta en la órbita del barajado. */
const SHUFFLE_ANGLES = Object.freeze([Math.PI, -Math.PI / 2, 0]);

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

function drawCardTexture(draw) {

    return createCanvasTexture(
        CARD_WIDTH * TEXTURE_SCALE,
        CARD_HEIGHT * TEXTURE_SCALE,
        ctx => {
            ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
            draw(ctx, CARD_WIDTH, CARD_HEIGHT);
        }
    );
}

function cardShape(ctx, w, h, inset, radius) {
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
}

function drawStar(ctx, x, y, size) {
    ctx.beginPath();

    for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? size : size * 0.28;
        const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;

        ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }

    ctx.closePath();
    ctx.fill();
}

function createBackTexture() {

    return drawCardTexture((ctx, w, h) => {
        const background = ctx.createLinearGradient(0, 0, w, h);

        background.addColorStop(0, '#3a1760');
        background.addColorStop(1, '#10061f');

        cardShape(ctx, w, h, 0, 10);
        ctx.fillStyle = background;
        ctx.fill();

        ctx.strokeStyle = '#e9c46a';
        ctx.lineWidth = 3;
        cardShape(ctx, w, h, 6, 7);
        ctx.stroke();

        ctx.lineWidth = 1;
        cardShape(ctx, w, h, 11, 5);
        ctx.stroke();

        const cx = w / 2;
        const cy = h / 2;

        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 38, 0, Math.PI * 2);
        ctx.stroke();

        /* Luna creciente. */
        ctx.fillStyle = '#f4d58d';
        ctx.beginPath();
        ctx.arc(cx, cy, 24, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#23103c';
        ctx.beginPath();
        ctx.arc(cx + 10, cy - 6, 21, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f4d58d';

        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            drawStar(ctx, cx + Math.cos(angle) * 56, cy + Math.sin(angle) * 56, i % 2 ? 4 : 6);
        }

        for (const [x, y] of [[24, 24], [w - 24, 24], [24, h - 24], [w - 24, h - 24]]) {
            drawStar(ctx, x, y, 6);
        }
    });
}

function createFrontTexture([numeral, name, symbol]) {

    return drawCardTexture((ctx, w, h) => {
        const parchment = ctx.createLinearGradient(0, 0, 0, h);

        parchment.addColorStop(0, '#f8ecc9');
        parchment.addColorStop(1, '#e2c285');

        cardShape(ctx, w, h, 0, 10);
        ctx.fillStyle = parchment;
        ctx.fill();

        ctx.strokeStyle = '#3a1d5c';
        ctx.lineWidth = 5;
        cardShape(ctx, w, h, 5, 8);
        ctx.stroke();

        ctx.strokeStyle = '#b8892f';
        ctx.lineWidth = 1.5;
        cardShape(ctx, w, h, 12, 5);
        ctx.stroke();

        ctx.fillStyle = '#3a1d5c';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = 'bold 20px Georgia, serif';
        ctx.fillText(numeral, w / 2, 32);

        ctx.shadowColor = 'rgba(155, 90, 220, 0.8)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#5b2a86';
        ctx.font = '84px "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", serif';
        ctx.fillText(symbol, w / 2, h / 2 + 4);

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#3a1d5c';
        ctx.font = 'bold 15px Georgia, serif';
        ctx.fillText(name, w / 2, h - 32, w - 30);
    });
}

export class FloatingCards {

    constructor({ glowTexture, origin, slots, onSparkle = () => {} }) {

        this.origin = origin;
        this.onSparkle = onSparkle;

        this.backTexture = createBackTexture();
        this.frontTextures = new Map();

        this.container = new Container();
        this.container.sortableChildren = true;

        this.cards = slots.map(slot => {
            const holder = new Container();

            const glow = new Sprite(glowTexture);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.tint = 0xc9a0ff;
            glow.width = CARD_WIDTH * 2.2;
            glow.height = CARD_HEIGHT * 1.9;

            const face = new Sprite(this.backTexture);
            face.anchor.set(0.5);
            face.scale.set(FACE_SCALE);

            holder.addChild(glow, face);
            holder.visible = false;

            this.container.addChild(holder);

            return {
                slot,
                holder,
                glow,
                face,
                revealed: false,
                from: null
            };
        });

        this.phase = 'hidden';
        this.time = 0;
    }

    get active() {
        return this.phase !== 'hidden' && this.phase !== 'dismiss';
    }

    start() {

        if (this.active) {
            return;
        }

        const picks = [...ARCANA]
            .sort(() => Math.random() - 0.5)
            .slice(0, this.cards.length);

        this.cards.forEach((card, index) => {
            card.front = this.#frontTexture(picks[index]);
            card.face.texture = this.backTexture;
            card.revealed = false;
            card.holder.visible = true;
        });

        this.#enter('summon');
    }

    stop() {

        if (!this.active) {
            return;
        }

        for (const card of this.cards) {
            card.from = {
                x: card.holder.x,
                y: card.holder.y,
                scale: card.holder.scale.x,
                alpha: card.holder.alpha
            };
        }

        this.#enter('dismiss');
    }

    update(dt, talk = 0) {

        if (this.phase === 'hidden') {
            return;
        }

        this.time += dt;

        const t = this.time;

        switch (this.phase) {

            case 'summon':
                this.cards.forEach((card, i) => this.#poseSummon(card, clamp01((t - i * SUMMON_STAGGER_S) / SUMMON_S)));

                if (t >= SUMMON_S + SUMMON_STAGGER_S * (this.cards.length - 1)) {
                    this.#enter('shuffle');
                }
                break;

            case 'shuffle':
                this.cards.forEach((card, i) => this.#poseShuffle(card, i, clamp01(t / SHUFFLE_S)));

                if (t >= SHUFFLE_S) {
                    this.#enter('reveal');
                }
                break;

            case 'reveal':
                this.cards.forEach((card, i) => this.#poseReveal(card, clamp01((t - i * FLIP_STAGGER_S) / FLIP_S)));

                if (t >= FLIP_STAGGER_S * (this.cards.length - 1) + FLIP_S) {
                    this.#enter('hover');
                }
                break;

            case 'hover':
                this.cards.forEach((card, i) => this.#poseHover(card, i, t, talk));
                break;

            case 'dismiss': {
                const p = clamp01(t / DISMISS_S);

                for (const card of this.cards) {
                    this.#poseDismiss(card, p, dt);
                }

                if (p >= 1) {
                    for (const card of this.cards) {
                        card.holder.visible = false;
                    }

                    this.phase = 'hidden';
                }
                break;
            }
        }
    }

    destroy() {

        this.backTexture.destroy(true);

        for (const texture of this.frontTextures.values()) {
            texture.destroy(true);
        }

        this.frontTextures.clear();
    }

    #enter(phase) {
        this.phase = phase;
        this.time = 0;
    }

    #frontTexture(arcana) {

        const key = arcana[1];

        if (!this.frontTextures.has(key)) {
            this.frontTextures.set(key, createFrontTexture(arcana));
        }

        return this.frontTextures.get(key);
    }

    #place(card, { x, y, rotation, scale, alpha, glow }) {

        const { holder } = card;

        holder.position.set(x, y);
        holder.rotation = rotation;
        holder.scale.set(scale);
        holder.alpha = alpha;
        holder.zIndex = y;

        card.glow.alpha = glow;
    }

    #poseSummon(card, p) {

        const { origin } = this;
        const { slot } = card;
        const e = easeOutBack(p);

        this.#place(card, {
            x: lerp(origin.x, slot.x, e),
            y: lerp(origin.y, slot.y, e) - Math.sin(Math.PI * p) * 60,
            rotation: lerp(-0.6, slot.rotation, e),
            scale: lerp(0.15, 1, easeOutCubic(p)),
            alpha: clamp01(p * 3),
            glow: 0.5 * Math.sin(Math.PI * p)
        });

        if (p > 0 && p < 1 && Math.random() < 0.35) {
            this.onSparkle(card.holder.x, card.holder.y, 1);
        }
    }

    #poseShuffle(card, index, p) {

        const { slot } = card;
        const base = SHUFFLE_ANGLES[index % SHUFFLE_ANGLES.length];
        const angle = base + easeInOutSine(p) * Math.PI * 2;

        /* Órbita que empieza y termina en el lugar de cada carta. */
        const depth = Math.sin(angle);

        this.#place(card, {
            x: slot.x + (Math.cos(angle) - Math.cos(base)) * 225,
            y: slot.y + (Math.sin(angle) - Math.sin(base)) * 45,
            rotation: slot.rotation + Math.sin(Math.PI * 2 * p) * 0.25,
            scale: 1 + depth * 0.1,
            alpha: 1,
            glow: 0.25 + 0.2 * Math.sin(Math.PI * p)
        });

        card.holder.zIndex = card.holder.y + depth * 100;
    }

    #poseReveal(card, p) {

        const { slot } = card;

        this.#place(card, {
            x: slot.x,
            y: slot.y - Math.sin(Math.PI * p) * 22,
            rotation: slot.rotation,
            scale: 1,
            alpha: 1,
            glow: card.revealed ? 0.9 * (1 - p) + 0.3 : 0.25
        });

        /* Volteo: se "achata" a la mitad y cambia de cara. */
        card.face.scale.x = FACE_SCALE * Math.abs(Math.cos(Math.PI * p));

        if (p >= 0.5 && !card.revealed) {
            card.revealed = true;
            card.face.texture = card.front;
            this.onSparkle(card.holder.x, card.holder.y, 14);
        }
    }

    #poseHover(card, index, t, talk) {

        const { slot } = card;

        card.face.scale.x = FACE_SCALE;

        this.#place(card, {
            x: slot.x,
            y: slot.y + Math.sin(t * 1.6 + index * 2) * 6 - talk * 4,
            rotation: slot.rotation + Math.sin(t * 1.1 + index) * 0.03,
            scale: 1,
            alpha: 1,
            glow: 0.3 + 0.15 * Math.sin(t * 2.4 + index) + talk * 0.2
        });
    }

    #poseDismiss(card, p, dt) {

        const { origin } = this;
        const from = card.from;
        const e = easeInCubic(p);

        card.face.scale.x = FACE_SCALE;

        this.#place(card, {
            x: lerp(from.x, origin.x, e),
            y: lerp(from.y, origin.y, e),
            rotation: card.holder.rotation + dt * 6,
            scale: lerp(from.scale, 0.1, e),
            alpha: from.alpha * (1 - p),
            glow: 0.4 * (1 - p)
        });
    }
}
