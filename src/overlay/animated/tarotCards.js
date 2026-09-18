import { Container, Graphics, MeshPlane } from '../vendor/pixi-8.20.1.min.mjs';

import { createAdditiveSprite } from './effects.js';

import {
    ARCANA,
    CARD_HEIGHT,
    CARD_WIDTH,
    createBackTexture,
    createBeamTexture,
    createFrontTexture,
    createSheenTexture
} from './cardArt.js';

import { GRID, fillCardUVs, isMirrored, projectCardVertices, vertexCount } from './cardGeometry.js';
import { NEXT_PHASE, cardProgress, cardTransform, phaseDuration, scrimTarget } from './cardChoreography.js';

/**
 * Cartas de tarot de la lectura.
 *
 * Cada carta es una MALLA, no un sprite: así se puede girar en 3D con
 * perspectiva de verdad (el borde que se acerca crece). Encima lleva una
 * banda de brillo que la recorre y, detrás, un haz de luz que la ilumina
 * en el momento de revelarse.
 *
 * Esta clase solo ARMA y APLICA: el "cuándo y dónde" vive en
 * cardChoreography.js y la proyección 3D en cardGeometry.js.
 */

/* Cuánto del ancho recorre la banda de brillo. */
const SHEEN_TRAVEL = 0.9;

/* El fundido del oscurecimiento del fondo (1/s). */
const SCRIM_BLEND = 4;

/* Cubre de sobra la escena (981 × 1602) más lo que sobre del encuadre. */
const SCRIM_MARGIN = 3000;

const VERTEX_VALUES = vertexCount() * 2;

function greyTint(shade) {

    const level = Math.max(0, Math.min(255, Math.round(shade * 255)));

    return (level << 16) | (level << 8) | level;
}

function createCardMesh(texture) {

    const mesh = new MeshPlane({
        texture,
        verticesX: GRID.columns,
        verticesY: GRID.rows
    });

    /* Si no, al cambiar de textura Pixi reconstruye la malla y pierde la pose. */
    mesh.autoResize = false;

    return mesh;
}

export class FloatingCards {

    constructor({ glowTexture, origin, slots, onSparkle = () => {}, onReveal = () => {} }) {

        this.origin = origin;
        this.onSparkle = onSparkle;
        this.onReveal = onReveal;

        this.backTexture = createBackTexture();
        this.sheenTexture = createSheenTexture();
        this.beamTexture = createBeamTexture();
        this.frontTextures = new Map();

        this.container = new Container();
        this.container.sortableChildren = true;

        /*
         * Oscurece la escena durante la lectura: la atención va a las cartas.
         * Es una capa APARTE: quien arma la escena la ubica entre el mago y
         * las cartas. Es más grande que la imagen del mago porque la escena
         * se escala con "contain" y puede quedar franja libre a los costados.
         */
        this.scrim = new Graphics()
            .rect(-SCRIM_MARGIN, -SCRIM_MARGIN, SCRIM_MARGIN * 3, SCRIM_MARGIN * 3)
            .fill(0x05010f);

        this.scrim.alpha = 0;

        this.vertices = new Float32Array(VERTEX_VALUES);
        this.uvs = new Float32Array(VERTEX_VALUES);

        this.cards = slots.map(slot => this.#createCard(slot, glowTexture));

        this.phase = 'hidden';

        /* `time` se reinicia en cada acto; `clock` corre toda la lectura. */
        this.time = 0;
        this.clock = 0;
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
            card.arcana = picks[index];
            card.front = this.#frontTexture(picks[index]);

            card.glow.tint = picks[index].tint;
            card.beam.tint = picks[index].tint;

            this.#setFace(card, false, false);

            card.revealed = false;
            card.holder.visible = true;
        });

        this.clock = 0;
        this.#enter('summon');
    }

    stop() {

        if (!this.active) {
            return;
        }

        /* Se sale desde donde esté cada carta, sin saltos. */
        for (const card of this.cards) {
            card.from = {
                x: card.holder.x,
                y: card.holder.y,
                rotation: card.holder.rotation,
                scale: card.holder.scale.x,
                alpha: card.holder.alpha,
                spinY: card.spinY,
                faceUp: card.showingFront
            };
        }

        this.#enter('dismiss');
    }

    update(dt, talk = 0) {

        if (this.phase !== 'hidden') {
            this.time += dt;
            this.clock += dt;

            const count = this.cards.length;

            this.cards.forEach((card, index) => {
                const transform = cardTransform({
                    phase: this.phase,
                    time: this.time,
                    clock: this.clock,
                    index,
                    count,
                    slot: card.slot,
                    origin: this.origin,
                    from: card.from,
                    talk
                });

                this.#apply(card, transform);

                /* Estela solo mientras ESA carta está en vuelo. */
                const flight = this.phase === 'summon' ? cardProgress('summon', this.time, index) : 0;

                if (flight > 0 && flight < 1 && Math.random() < 0.3) {
                    this.onSparkle(transform.x, transform.y, 1);
                }
            });

            if (this.time >= phaseDuration(this.phase, count)) {
                this.#enter(NEXT_PHASE[this.phase]);
            }
        }

        this.#updateScrim(dt);
    }

    destroy() {

        for (const texture of [this.backTexture, this.sheenTexture, this.beamTexture, ...this.frontTextures.values()]) {
            texture.destroy(true);
        }

        this.frontTextures.clear();
    }

    #createCard(slot, glowTexture) {

        const holder = new Container();

        const glow = createAdditiveSprite(glowTexture, { visible: true });

        glow.width = CARD_WIDTH * 2.4;
        glow.height = CARD_HEIGHT * 2;

        const face = createCardMesh(this.backTexture);

        const sheen = createCardMesh(this.sheenTexture);

        sheen.blendMode = 'add';
        sheen.alpha = 0;

        /* Fogonazo blanco del instante del volteo. */
        const flash = createAdditiveSprite(glowTexture, { visible: true });

        flash.width = CARD_WIDTH * 1.9;
        flash.height = CARD_HEIGHT * 1.5;
        flash.alpha = 0;

        holder.addChild(glow, face, sheen, flash);
        holder.visible = false;

        /* El haz es vertical en la escena: no gira con la carta. */
        const beam = createAdditiveSprite(this.beamTexture, { anchorY: 1, visible: true });

        beam.width = CARD_WIDTH * 2.6;
        beam.height = 640;
        beam.position.set(slot.x, slot.y + CARD_HEIGHT * 0.36);
        beam.alpha = 0;
        beam.zIndex = slot.y - 400;

        this.container.addChild(holder, beam);

        return {
            slot,
            holder,
            glow,
            face,
            sheen,
            flash,
            beam,
            arcana: null,
            front: null,
            showingFront: false,
            mirrored: false,
            spinY: 0,
            revealed: false,
            from: null
        };
    }

    #frontTexture(arcana) {

        if (!this.frontTextures.has(arcana.name)) {
            this.frontTextures.set(arcana.name, createFrontTexture(arcana));
        }

        return this.frontTextures.get(arcana.name);
    }

    #enter(phase) {
        this.phase = phase;
        this.time = 0;

        if (phase === 'hidden') {
            for (const card of this.cards) {
                card.holder.visible = false;
                card.beam.alpha = 0;
            }
        }
    }

    /*
     * Dos decisiones independientes:
     *   faceUp   → QUÉ textura se ve (lo decide la coreografía).
     *   mirrored → si la malla está dada vuelta (lo decide la geometría).
     * Si la malla está dada vuelta, las UV se espejan para que el nombre de
     * la carta, o la luna del dorso, no se vean al revés.
     */
    #setFace(card, faceUp, mirrored) {

        card.showingFront = faceUp;
        card.mirrored = mirrored;
        card.face.texture = faceUp ? card.front : this.backTexture;

        this.#writeUVs(card.face, mirrored, 0);
    }

    #writeUVs(mesh, mirrored, offsetU) {

        const buffer = mesh.geometry.getAttribute('aUV').buffer;

        fillCardUVs(this.uvs, { mirrored, offsetU });
        buffer.data.set(this.uvs);
        buffer.update();
    }

    #writeVertices(mesh, spinY, tilt) {

        const buffer = mesh.geometry.getAttribute('aPosition').buffer;

        projectCardVertices(this.vertices, {
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            spinY,
            tilt
        });

        buffer.data.set(this.vertices);
        buffer.update();
    }

    #apply(card, transform) {

        const { holder } = card;

        holder.position.set(transform.x, transform.y);
        holder.rotation = transform.rotation;
        holder.scale.set(transform.scale);
        holder.alpha = transform.alpha;
        holder.zIndex = transform.y + transform.depth * 120;

        /* Para que un cierre anticipado salga desde el giro real de la carta. */
        card.spinY = transform.spinY;

        const mirrored = isMirrored(transform.spinY);

        if (transform.faceUp !== card.showingFront || mirrored !== card.mirrored) {
            this.#setFace(card, transform.faceUp, mirrored);
        }

        this.#writeVertices(card.face, transform.spinY, transform.tilt);

        if (transform.sheen >= 0) {
            /* El brillo comparte la deformación de la cara, no la recalcula. */
            const sheenPositions = card.sheen.geometry.getAttribute('aPosition').buffer;

            sheenPositions.data.set(this.vertices);
            sheenPositions.update();

            card.sheen.alpha = Math.sin(Math.PI * transform.sheen) * 0.9;
            this.#writeUVs(card.sheen, mirrored, (transform.sheen * 2 - 1) * SHEEN_TRAVEL);
        } else {
            card.sheen.alpha = 0;
        }

        card.face.tint = greyTint(transform.shade);
        card.glow.alpha = transform.glow;
        card.flash.alpha = transform.flash;
        card.beam.alpha = transform.beam * 0.55;

        if (transform.faceUp && !card.revealed) {
            card.revealed = true;
            this.onReveal(transform.x, transform.y, card.arcana?.tint ?? 0xffffff, card.arcana?.name ?? '');
        }
    }

    #updateScrim(dt) {

        const target = scrimTarget(this.phase);
        const blend = 1 - Math.exp(-dt * SCRIM_BLEND);

        this.scrim.alpha += (target - this.scrim.alpha) * blend;

        if (this.scrim.alpha < 0.002) {
            this.scrim.alpha = 0;
        }
    }
}
