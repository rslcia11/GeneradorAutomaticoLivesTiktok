/**
 * Catálogo de servicios del LIVE.
 *
 * Traduce el apoyo del espectador (monedas de regalos acumuladas en las
 * últimas 24 h) en el tipo de respuesta que recibe.
 *
 * Reglas del catálogo:
 * - `coins`: monedas acumuladas necesarias para desbloquearlo.
 * - `level`: qué tan buena es la respuesta. Se entrega SIEMPRE el nivel
 *   más alto que el espectador pueda pagar, aunque otro servicio cueste
 *   más (así regalar de más nunca da una respuesta peor).
 * - `style`: cómo responde la IA (ver RESPONSE_STYLES).
 * - `cards`: si el mago saca cartas.
 * - `priority`: prioridad en la cola (mayor = se responde antes).
 *
 * Se puede reemplazar por completo con un archivo JSON:
 *   SERVICES_FILE=./mis-servicios.json
 */

export const RESPONSE_STYLES = Object.freeze({
    /* Gratis: una sola vez cada 24 h. */
    YES_NO: 'yes_no',
    SHORT: 'short',
    FULL: 'full',
    READING: 'reading',
    READING_LONG: 'reading_long'
});

/*
 * ⚙️ AJUSTA AQUÍ tus precios. Los de "Prioridad" están pendientes de
 * confirmar con el nombre real del regalo en TikTok.
 */
export const DEFAULT_SERVICES = Object.freeze([
    {
        id: 'free',
        label: 'Respuesta gratis',
        gift: null,
        coins: 0,
        level: 0,
        style: RESPONSE_STYLES.YES_NO,
        cards: false,
        priority: 30,

        /* Solo para el nivel gratis: una respuesta por persona cada 24 h. */
        freeEveryHours: 24,

        /* No se muestra en el menú de regalos del overlay. */
        menu: false
    },
    {
        id: 'oraculo_dia',
        label: 'Oráculo del Día',
        gift: 'Oráculo del Día',
        icon: '🌹',
        coins: 29,
        level: 1,
        style: RESPONSE_STYLES.SHORT,
        cards: false,
        priority: 50,
        menu: true
    },
    {
        id: 'lectura_3',
        label: 'Lectura 3 Cartas',
        gift: 'Lectura 3 Cartas',
        icon: '💝',
        coins: 270,
        level: 3,
        style: RESPONSE_STYLES.READING,
        cards: true,
        priority: 70,
        menu: true
    },
    {
        id: 'pregunta_rapida',
        label: 'Pregunta Rápida',
        gift: 'Pregunta Rápida',
        icon: '🍭',
        coins: 200,
        level: 2,
        style: RESPONSE_STYLES.FULL,
        cards: false,
        priority: 60,
        menu: true
    },
    {
        id: 'prioridad_3',
        label: 'Prioridad 3 Cartas',
        gift: 'Prioridad 3 Cartas',
        icon: '🦊',
        coins: 500,
        level: 4,
        style: RESPONSE_STYLES.READING,
        cards: true,
        priority: 90,
        menu: true
    },
    {
        id: 'prioridad_5',
        label: 'Prioridad 5 Cartas',
        gift: 'Prioridad 5 Cartas',
        icon: '🔮',
        coins: 800,
        level: 5,
        style: RESPONSE_STYLES.READING_LONG,
        cards: true,
        priority: 100,
        menu: true
    }
]);

const STYLES = new Set(Object.values(RESPONSE_STYLES));

/**
 * Valida y ordena un catálogo (de menor a mayor nivel).
 * Lanza error si está mal configurado: mejor fallar al iniciar
 * que responder cualquier cosa en pleno LIVE.
 */
export function createCatalog(services = DEFAULT_SERVICES) {

    if (!Array.isArray(services) || services.length === 0) {
        throw new Error('El catálogo de servicios está vacío');
    }

    const seen = new Set();

    const validated = services.map(service => {

        for (const field of ['id', 'label', 'style']) {
            if (typeof service?.[field] !== 'string' || !service[field].trim()) {
                throw new Error(`Servicio sin "${field}" válido`);
            }
        }

        if (!STYLES.has(service.style)) {
            throw new Error(`Estilo de respuesta inválido: ${service.style}`);
        }

        for (const field of ['coins', 'level', 'priority']) {
            if (!Number.isFinite(service[field]) || service[field] < 0) {
                throw new Error(`Servicio "${service.id}" con "${field}" inválido`);
            }
        }

        if (seen.has(service.id)) {
            throw new Error(`Servicio duplicado: ${service.id}`);
        }

        seen.add(service.id);

        return Object.freeze({
            gift: null,
            cards: false,
            menu: false,
            freeEveryHours: null,
            ...service
        });
    });

    if (!validated.some(service => service.coins === 0)) {
        throw new Error('El catálogo necesita un servicio gratis (coins: 0)');
    }

    return Object.freeze(
        [...validated].sort((a, b) => a.level - b.level || a.coins - b.coins)
    );
}

/**
 * Servicio que corresponde a `coins` acumuladas: el de mayor nivel
 * que alcance a pagar.
 */
export function resolveService(catalog, coins) {

    const affordable = Number.isFinite(coins) && coins > 0 ? coins : 0;

    let best = catalog[0];

    for (const service of catalog) {
        if (service.coins <= affordable && service.level >= best.level) {
            best = service;
        }
    }

    return best;
}

/** Servicios que se muestran en el menú del overlay, del más barato al más caro. */
export function menuServices(catalog) {
    return catalog
        .filter(service => service.menu)
        .sort((a, b) => a.coins - b.coins);
}
