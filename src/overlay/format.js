/**
 * Formato compartido del overlay: todos los números de la pantalla
 * (likes, espectadores, monedas del HUD) se ven igual.
 */
const numberFormat = new Intl.NumberFormat('es-EC');

export function formatNumber(value, fallback = String(value)) {

    const number = Number(value);

    return Number.isFinite(number)
        ? numberFormat.format(number)
        : fallback;
}
