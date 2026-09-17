/**
 * Warp rig
 *
 * Deforma una imagen plana como una "lámina de goma":
 * la imagen se apoya sobre una malla de vértices y cada
 * deformador mueve solo los vértices de su zona
 * (barba, manos, sombrero...), con caída suave hacia
 * los bordes para que no se noten cortes.
 *
 * Todo en coordenadas de píxel de la textura original.
 *
 * Es matemática pura (sin PixiJS ni DOM):
 * se prueba en Node con src/test-warp.js.
 */

/**
 * Peso de un punto dentro de una elipse:
 * 1 en el centro, 0 en el borde, curva suave.
 */
export function ellipseWeight(x, y, { cx, cy, rx, ry }) {

    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;

    const distanceSquared = nx * nx + ny * ny;

    if (distanceSquared >= 1) {
        return 0;
    }

    const falloff = 1 - distanceSquared;

    return falloff * falloff;
}

export function smoothstep(edge0, edge1, value) {

    const t = Math.min(
        1,
        Math.max(0, (value - edge0) / (edge1 - edge0))
    );

    return t * t * (3 - 2 * t);
}

/**
 * Limita un deformador a una franja horizontal.
 * Ej.: la mandíbula solo mueve lo que está DEBAJO de la boca.
 */
function gateWeight(y, gate) {

    if (!gate) {
        return 1;
    }

    let weight = 1;

    if (gate.below !== undefined) {
        weight *= smoothstep(
            gate.below - gate.soft,
            gate.below + gate.soft,
            y
        );
    }

    if (gate.above !== undefined) {
        weight *= 1 - smoothstep(
            gate.above - gate.soft,
            gate.above + gate.soft,
            y
        );
    }

    return weight;
}

/**
 * Cuánto está "clavado" un punto (0 libre, 1 inmóvil).
 * La bola de cristal y la mesa no deben deformarse.
 */
export function pinStrength(x, y, pins) {

    let strength = 0;

    for (const pin of pins) {

        if (pin.belowY !== undefined) {
            strength = Math.max(
                strength,
                smoothstep(pin.belowY - pin.soft, pin.belowY + pin.soft, y)
            );
            continue;
        }

        const nx = (x - pin.cx) / pin.rx;
        const ny = (y - pin.cy) / pin.ry;

        const distance = Math.sqrt(nx * nx + ny * ny);

        strength = Math.max(
            strength,
            1 - smoothstep(1, 1 + pin.soft, distance)
        );
    }

    return strength;
}

/**
 * Precalcula qué vértices afecta cada deformador y con qué peso.
 * Así cada frame solo recorre los vértices relevantes.
 *
 * base: Float32Array [x0, y0, x1, y1, ...]
 */
export function createRig({ base, deformers, pins = [] }) {

    const vertexCount = base.length / 2;

    const freedom = new Float32Array(vertexCount);

    for (let v = 0; v < vertexCount; v++) {
        freedom[v] = 1 - pinStrength(base[v * 2], base[v * 2 + 1], pins);
    }

    const compiled = deformers.map(deformer => {

        const indices = [];
        const weights = [];

        for (let v = 0; v < vertexCount; v++) {

            const x = base[v * 2];
            const y = base[v * 2 + 1];

            const weight =
                ellipseWeight(x, y, deformer.area) *
                gateWeight(y, deformer.gate) *
                freedom[v];

            if (weight > 0.0001) {
                indices.push(v * 2);
                weights.push(weight);
            }
        }

        return {
            ...deformer,
            indices: Uint32Array.from(indices),
            weights: Float32Array.from(weights)
        };
    });

    return {
        base: Float32Array.from(base),
        deformers: compiled
    };
}

/**
 * Atenúa el valor de un deformador hacia su neutro
 * (weight 1 = sin cambios, 0 = no deforma).
 */
export function weightRigValue(kind, value, weight) {

    switch (kind) {
        case 'translate':
            value.dx = (value.dx ?? 0) * weight;
            value.dy = (value.dy ?? 0) * weight;
            break;

        case 'rotate':
            value.angle = (value.angle ?? 0) * weight;
            break;

        case 'scale':
            value.sx = 1 + ((value.sx ?? 1) - 1) * weight;
            value.sy = 1 + ((value.sy ?? 1) - 1) * weight;
            break;

        case 'squash':
            value.amount = (value.amount ?? 0) * weight;
            break;
    }
}

/**
 * Escribe en `out` la malla deformada según `values`:
 *
 *   translate → { dx, dy }
 *   rotate    → { angle }        (radianes, alrededor de pivot)
 *   scale     → { sx, sy }       (alrededor de pivot)
 *   squash    → { amount }       (aplasta hacia pivot.y, p. ej. parpadeo)
 *
 * Los efectos se suman: son desplazamientos pequeños.
 */
export function applyRig(rig, out, values) {

    const { base } = rig;

    out.set(base);

    for (const deformer of rig.deformers) {

        const value = values[deformer.name];

        if (!value) {
            continue;
        }

        const { indices, weights } = deformer;
        const count = indices.length;

        switch (deformer.kind) {

            case 'translate': {
                const dx = value.dx ?? 0;
                const dy = value.dy ?? 0;

                if (dx === 0 && dy === 0) {
                    break;
                }

                for (let i = 0; i < count; i++) {
                    const k = indices[i];
                    out[k] += dx * weights[i];
                    out[k + 1] += dy * weights[i];
                }
                break;
            }

            case 'rotate': {
                const angle = value.angle ?? 0;

                if (angle === 0) {
                    break;
                }

                const cosMinusOne = Math.cos(angle) - 1;
                const sin = Math.sin(angle);
                const { x: px, y: py } = deformer.pivot;

                for (let i = 0; i < count; i++) {
                    const k = indices[i];
                    const rx = base[k] - px;
                    const ry = base[k + 1] - py;

                    out[k] += (rx * cosMinusOne - ry * sin) * weights[i];
                    out[k + 1] += (rx * sin + ry * cosMinusOne) * weights[i];
                }
                break;
            }

            case 'scale': {
                const sx = (value.sx ?? 1) - 1;
                const sy = (value.sy ?? 1) - 1;

                if (sx === 0 && sy === 0) {
                    break;
                }

                const { x: px, y: py } = deformer.pivot;

                for (let i = 0; i < count; i++) {
                    const k = indices[i];
                    out[k] += (base[k] - px) * sx * weights[i];
                    out[k + 1] += (base[k + 1] - py) * sy * weights[i];
                }
                break;
            }

            case 'squash': {
                const amount = value.amount ?? 0;

                if (amount === 0) {
                    break;
                }

                const { y: py } = deformer.pivot;

                for (let i = 0; i < count; i++) {
                    const k = indices[i];
                    out[k + 1] += (py - base[k + 1]) * amount * weights[i];
                }
                break;
            }

            default:
                throw new Error(
                    `Tipo de deformador desconocido: ${deformer.kind}`
                );
        }
    }
}
