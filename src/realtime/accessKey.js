import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Clave secreta del overlay.
 *
 * Va en la URL que el tarotista pega en OBS (`?key=...`). Sin ella, ni la
 * página ni el WebSocket responden. Es lo único que separa el overlay de
 * un cliente de cualquiera que adivine la dirección del servidor.
 */

const MIN_KEY_LENGTH = 32;

/** Genera una clave nueva (43 caracteres base64url, 256 bits). */
export function generateAccessKey() {
    return randomBytes(32).toString('base64url');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export const isLoopback = host => LOOPBACK.has(host);

/**
 * Resuelve la clave a partir del entorno.
 *
 * - Con `OVERLAY_KEY`: se exige siempre (también en local).
 * - Sin clave y escuchando solo en loopback: se permite (desarrollo).
 * - Sin clave y expuesto a la red: error. Nunca se arranca abierto.
 */
export function resolveAccessKey(env = {}, { host = '127.0.0.1' } = {}) {

    const key = (env.OVERLAY_KEY ?? '').toString().trim();

    if (key.length === 0) {
        if (!isLoopback(host)) {
            throw new Error(
                `OVERLAY_KEY es obligatoria para escuchar en ${host}. ` +
                'Genera una con: node scripts/make-key.js'
            );
        }

        return null;
    }

    if (key.length < MIN_KEY_LENGTH) {
        throw new Error(
            `OVERLAY_KEY es demasiado corta (${key.length} caracteres; mínimo ${MIN_KEY_LENGTH}). ` +
            'Genera una con: node scripts/make-key.js'
        );
    }

    return key;
}

/** Comparación en tiempo constante: no revela cuántos caracteres coinciden. */
export function keyMatches(candidate, expected) {

    if (typeof candidate !== 'string' || typeof expected !== 'string') {
        return false;
    }

    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
}

/** Lee `?key=` de una URL o de la parte de búsqueda de una petición. */
export function keyFromSearch(search) {
    return new URLSearchParams(search ?? '').get('key') ?? '';
}
