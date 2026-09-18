/**
 * Poses del mago: imágenes completas del personaje en otro gesto,
 * alineadas píxel a píxel con assets/tarot-character.png (981 × 1602).
 *
 * Agregar una pose = 1 archivo en assets/poses + 1 línea en POSE_FILES
 * (+ su regla en selectPose).
 */

import { smoothstep } from './warp.js';

export const BASE_POSE = 'base';

export const POSE_FILES = Object.freeze({
    thinking:    'poses/thinking.webp',
    tarot:       'poses/tarot.webp',
    comment:     'poses/comment.webp',
    'comment-2': 'poses/comment-2.webp',
    'comment-3': 'poses/comment-3.webp',
    'thanks-1':  'poses/thanks-1.webp',
    'thanks-2':  'poses/thanks-2.webp',
    invite:      'poses/invite.webp',
    listening:   'poses/listening.webp',
    react:       'poses/react.webp'
});

const INTENT_POSES = Object.freeze({
    tarot_reading: ['tarot'],
    thanks:        ['thanks-1', 'thanks-2'],
    invite_share:  ['invite'],
    comment:       ['comment', 'comment-2', 'comment-3']
});

/**
 * Pose para un cambio de estado. Se elige UNA vez por evento
 * (no por frame), así la variante no parpadea mientras habla.
 *
 * @param {{ state: string, intent?: string|null }} detail
 * @param {() => number} random 0..1
 */
export function selectPose({ state, intent = null }, random = Math.random) {

    if (state === 'thinking') {
        return 'thinking';
    }

    if (state === 'listening') {
        return 'listening';
    }

    if (state === 'reacting') {
        return 'react';
    }

    if (state !== 'speaking') {
        return BASE_POSE;
    }

    const options = INTENT_POSES[intent] ?? INTENT_POSES.comment;

    return options[Math.min(Math.floor(random() * options.length), options.length - 1)];
}

/**
 * Fundido entre poses SIN fantasmas.
 *
 * Todas las poses tienen la misma silueta opaca, así que la pose nueva
 * aparece ENCIMA de la actual y, cuando llega a opacidad 1, las de abajo
 * se descartan. Nunca se mezclan más de dos poses a la vez (salvo
 * cambios muy seguidos) y nunca se ve el fondo a través del mago.
 */
export class PoseBlender {

    constructor({ fadeS = 0.25, initial = BASE_POSE } = {}) {
        this.fadeS = fadeS;

        /* De abajo hacia arriba. La de abajo siempre tiene alpha 1. */
        this.stack = [{ key: initial, alpha: 1 }];
    }

    get current() {
        return this.stack.at(-1).key;
    }

    setTarget(key) {

        if (key === this.current) {
            return false;
        }

        const index = this.stack.findIndex(layer => layer.key === key);
        let alpha = 0;

        if (index !== -1) {
            /*
             * Ya estaba visible en parte: sube arriba conservando
             * cuánto se veía. Con dos capas no hay salto; con tres
             * (cambios en menos de fadeS) el salto es mínimo.
             */
            alpha = this.visibility(index);
            this.stack.splice(index, 1);

            if (index === 0) {
                this.stack[0].alpha = 1;
            }
        }

        this.stack.push({ key, alpha });

        return true;
    }

    /* Cuánto se ve realmente la capa `index` (lo tapan las de arriba). */
    visibility(index) {

        let visible = this.stack[index].alpha;

        for (let i = index + 1; i < this.stack.length; i++) {
            visible *= 1 - this.stack[i].alpha;
        }

        return visible;
    }

    /* Cuánto se ve la pose `key` en pantalla (0 si no está en la pila). */
    visibilityOf(key) {

        const index = this.stack.findIndex(layer => layer.key === key);

        return index === -1 ? 0 : this.visibility(index);
    }

    update(dt) {

        const top = this.stack.at(-1);

        top.alpha = Math.min(1, top.alpha + dt / this.fadeS);

        if (top.alpha === 1 && this.stack.length > 1) {
            this.stack = [top];
        }
    }

    /* Alpha visual (con easing) de cada pose; 0 si no está en la pila. */
    alphaOf(key) {

        const layer = this.stack.find(entry => entry.key === key);

        return layer ? smoothstep(0, 1, layer.alpha) : 0;
    }

    /* Orden de dibujo, de abajo hacia arriba. */
    order() {
        return this.stack.map(layer => layer.key);
    }
}
