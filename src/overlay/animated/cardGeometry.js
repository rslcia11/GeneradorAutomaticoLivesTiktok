/**
 * Proyección 3D de una carta sobre un plano 2D.
 *
 * PixiJS es un motor 2D: no sabe rotar una carta "hacia adentro" de la
 * pantalla. Lo que hacemos es tratar la carta como una malla (grilla de
 * vértices), rotarla en 3D a mano y proyectarla con una cámara pinhole.
 * El resultado es un volteo con perspectiva REAL: el borde que se acerca
 * crece, el que se aleja se encoge.
 *
 * Matemática pura: sin Pixi, sin DOM. Por eso se puede probar en Node.
 */

/* Distancia de la cámara al plano de la carta, en píxeles de la escena. */
export const CAMERA_DISTANCE = 1000;

/* Resolución de la malla: con pocas columnas la textura se "quiebra". */
export const GRID = Object.freeze({ columns: 12, rows: 4 });

export function vertexCount({ columns, rows } = GRID) {
    return columns * rows;
}

/**
 * Escribe en `out` (Float32Array de columnas*filas*2) la posición de cada
 * vértice, centrada en (0, 0).
 *
 * spinY: giro sobre el eje vertical (el volteo).
 * tilt:  giro sobre el eje horizontal (la inclinación que da parallax).
 */
export function projectCardVertices(out, {
    columns = GRID.columns,
    rows = GRID.rows,
    width,
    height,
    spinY = 0,
    tilt = 0,
    camera = CAMERA_DISTANCE
} = {}) {

    const cosY = Math.cos(spinY);
    const sinY = Math.sin(spinY);
    const cosX = Math.cos(tilt);
    const sinX = Math.sin(tilt);

    let i = 0;

    for (let row = 0; row < rows; row++) {

        const v = rows === 1 ? 0.5 : row / (rows - 1);
        const localY = (v - 0.5) * height;

        for (let col = 0; col < columns; col++) {

            const u = columns === 1 ? 0.5 : col / (columns - 1);
            const localX = (u - 0.5) * width;

            /* Giro sobre Y: la anchura se acorta y aparece profundidad. */
            const x1 = localX * cosY;
            const z1 = -localX * sinY;

            /* Giro sobre X: mezcla altura y profundidad. */
            const y2 = localY * cosX - z1 * sinX;
            const z2 = localY * sinX + z1 * cosX;

            /*
             * Perspectiva: lo que está más cerca de la cámara (z2 > 0)
             * se agranda. El máximo z2 posible es media diagonal de la
             * carta, muy por debajo de `camera`, así que nunca se invierte.
             */
            const scale = camera / (camera - z2);

            out[i++] = x1 * scale;
            out[i++] = y2 * scale;
        }
    }

    return out;
}

/**
 * ¿La malla quedó dada vuelta? Pasados los 90° vemos su reverso geométrico
 * y cualquier textura (cara O dorso) saldría espejada si no se corrige.
 * Es pura geometría: no depende de qué textura se esté mostrando.
 */
export function isMirrored(spinY) {
    return Math.cos(spinY) < 0;
}

/**
 * Coordenadas de textura.
 *
 * `mirrored` es clave: cuando la carta pasa de los 90°, estamos viendo su
 * REVERSO geométrico. Si no invertimos la U, el nombre de la carta se lee
 * al espejo. `offsetU` desplaza la textura para el barrido de brillo.
 */
export function fillCardUVs(out, {
    columns = GRID.columns,
    rows = GRID.rows,
    mirrored = false,
    offsetU = 0
} = {}) {

    let i = 0;

    for (let row = 0; row < rows; row++) {

        const v = rows === 1 ? 0.5 : row / (rows - 1);

        for (let col = 0; col < columns; col++) {

            const u = columns === 1 ? 0.5 : col / (columns - 1);

            out[i++] = (mirrored ? 1 - u : u) - offsetU;
            out[i++] = v;
        }
    }

    return out;
}
