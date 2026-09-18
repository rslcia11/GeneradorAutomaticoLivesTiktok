import { readFileSync } from 'node:fs';

/**
 * Configuración del streamer (`streamer.config.json`, no se sube a git).
 *
 * Es para los datos propios de cada tarotista: su frase de contacto, su
 * teléfono, cada cuánto aparece. Las CLAVES (Gemini) siguen yendo en
 * `.env`: esto no es para secretos, es para preferencias.
 *
 * Prioridad: variable de entorno > archivo > valor por defecto.
 */

export const DEFAULT_CONTACT = Object.freeze({
    enabled: false,
    text: '',
    visibleSeconds: 12,
    everyMinutes: 10
});

export function readStreamerConfig(path, { read = readFileSync, warn = console.warn } = {}) {

    try {
        const parsed = JSON.parse(read(path, 'utf8'));

        return parsed && typeof parsed === 'object' ? parsed : {};

    } catch (error) {
        if (error.code !== 'ENOENT') {
            warn(`⚠️ ${path} no se pudo leer (${error.message}); se usan los valores por defecto`);
        }

        return {};
    }
}

const asBoolean = value =>
    typeof value === 'string' ? value.trim().toLowerCase() === 'true' : value === true;

const asNumber = (value, fallback) => {
    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
 * Promoción fija del overlay (streamer.config.json → promo o env PROMO_*).
 * Apagada por defecto: el streamer la activa añadiendo texto.
 */
export function resolvePromo(file = {}, env = {}) {
    const fromFile = file.promo ?? {};
    const text = (env.PROMO_TEXT ?? fromFile.text ?? '').toString().trim();
    const enabled = text.length > 0 && (env.PROMO_ENABLED !== undefined
        ? asBoolean(env.PROMO_ENABLED)
        : asBoolean(fromFile.enabled));
    return { enabled, text };
}

/**
 * Usuario de TikTok del streamer.
 * Prioridad: TIKTOK_USERNAME en .env > tiktokUsername en streamer.config.json.
 * Lanza si no está configurado en ninguno de los dos.
 */
export function resolveTiktokUsername(file = {}, env = {}) {
    const username = (env.TIKTOK_USERNAME ?? file.tiktokUsername ?? '').toString().trim();

    if (!username) {
        throw new Error(
            'Usuario de TikTok no configurado. ' +
            'Pon TIKTOK_USERNAME=tu_usuario en .env ' +
            'o tiktokUsername en streamer.config.json'
        );
    }

    return username;
}

/** Franja de contacto, tomando lo que haya en el entorno, el archivo o el defecto. */
export function resolveContact(file = {}, env = {}) {

    const fromFile = file.contact ?? {};

    const enabled = env.CONTACT_ENABLED !== undefined
        ? asBoolean(env.CONTACT_ENABLED)
        : asBoolean(fromFile.enabled);

    const text = (env.CONTACT_TEXT ?? fromFile.text ?? DEFAULT_CONTACT.text).toString().trim();

    return {
        /* Sin texto no hay nada que mostrar, aunque esté encendida. */
        enabled: enabled && text.length > 0,
        text,
        visibleSeconds: asNumber(env.CONTACT_VISIBLE_SECONDS ?? fromFile.visibleSeconds, DEFAULT_CONTACT.visibleSeconds),
        everyMinutes: asNumber(env.CONTACT_EVERY_MINUTES ?? fromFile.everyMinutes, DEFAULT_CONTACT.everyMinutes)
    };
}
