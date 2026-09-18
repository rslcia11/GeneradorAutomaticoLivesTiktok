/**
 * Regalos REALES de la sala de TikTok (nombre, imagen y precio).
 *
 * TikTok entrega la lista con `gift/list/`. Aquí se limpia y se usa para
 * que el menú del overlay muestre el regalo original que desbloquea cada
 * servicio, en vez de un emoji y un número.
 *
 * Los precios de los regalos cambian según el país, por eso NO se escriben
 * a mano: se leen de la sala en cada LIVE.
 */

function imageOf(image) {

    const url = image?.url_list?.[0] ?? image?.urlList?.[0] ?? null;

    /* Solo https: la URL termina en un <img> del overlay. */
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** Respuesta cruda de TikTok → [{ id, name, coins, image }], de barato a caro. */
export function normalizeGifts(raw) {

    if (!Array.isArray(raw)) {
        return [];
    }

    const seen = new Set();
    const gifts = [];

    for (const gift of raw) {

        const coins = Number(gift?.diamond_count ?? gift?.diamondCount);
        const name = typeof gift?.name === 'string' ? gift.name.trim() : '';
        const image = imageOf(gift?.image) ?? imageOf(gift?.icon);

        /* Los que no están en el panel no los puede enviar el público. */
        const hidden = gift?.is_displayed_on_panel === false || gift?.isDisplayedOnPanel === false;

        if (!name || !image || hidden || !Number.isFinite(coins) || coins <= 0) {
            continue;
        }

        const key = String(gift.id ?? name);

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        gifts.push({ id: key, name, coins, image });
    }

    return gifts.sort((a, b) => a.coins - b.coins);
}

/**
 * El regalo que se muestra para un servicio: el MÁS BARATO que, enviado,
 * desbloquea EXACTAMENTE ese servicio (`unlocks` es la regla real de la
 * economía). Si ningún regalo de la sala cae justo en ese servicio, no se
 * muestra ninguno: el menú nunca promete algo que el regalo no da.
 */
export function giftForService(service, gifts, unlocks) {

    if (!service || service.coins <= 0) {
        return null;
    }

    return gifts.find(gift =>
        gift.coins >= service.coins && unlocks(gift.coins)?.id === service.id
    ) ?? null;
}

/** Menú con el regalo real de cada servicio (si la sala lo ofrece). */
export function decorateMenu(services, gifts, unlocks) {

    return services.map(service => {
        const gift = giftForService(service, gifts, unlocks);

        return gift
            ? { ...service, tiktokGift: { name: gift.name, image: gift.image, coins: gift.coins } }
            : service;
    });
}
