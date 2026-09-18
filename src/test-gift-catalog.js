import assert from 'node:assert/strict';

import { decorateMenu, giftForService, normalizeGifts } from './rules/giftCatalog.js';
import { createCatalog, menuServices, resolveService } from './rules/serviceCatalog.js';

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;

    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

/* Forma real de `gift/list/` de TikTok (snake_case). */
const RAW = [
    { id: 5655, name: 'Rose', diamond_count: 1, image: { url_list: ['https://p16-webcast.tiktokcdn.com/rose.png'] } },
    { id: 5879, name: 'Doughnut', diamond_count: 30, image: { url_list: ['https://p16-webcast.tiktokcdn.com/donut.png'] } },
    { id: 7934, name: 'Hat and Mustache', diamond_count: 99, image: { url_list: ['https://p16-webcast.tiktokcdn.com/hat.png'] } },
    { id: 6437, name: 'Sunglasses', diamond_count: 199, image: { url_list: ['https://p16-webcast.tiktokcdn.com/sun.png'] } },
    { id: 6267, name: 'Corgi', diamond_count: 299, image: { url_list: ['https://p16-webcast.tiktokcdn.com/corgi.png'] } },
    { id: 7168, name: 'Money Gun', diamond_count: 500, image: { url_list: ['https://p16-webcast.tiktokcdn.com/gun.png'] } }
];


test('Normaliza la lista de TikTok y la ordena de barato a caro', () => {
    const gifts = normalizeGifts([...RAW].reverse());

    assert.equal(gifts.length, RAW.length);
    assert.deepEqual(gifts.map(g => g.coins), [1, 30, 99, 199, 299, 500]);
    assert.deepEqual(gifts[1], {
        id: '5879',
        name: 'Doughnut',
        coins: 30,
        image: 'https://p16-webcast.tiktokcdn.com/donut.png'
    });
});

test('Acepta también la forma camelCase', () => {
    const [gift] = normalizeGifts([
        { id: 1, name: 'Rose', diamondCount: 1, image: { urlList: ['https://cdn/rose.png'] } }
    ]);

    assert.equal(gift.coins, 1);
    assert.equal(gift.image, 'https://cdn/rose.png');
});

test('Descarta regalos que el público no puede enviar o que están incompletos', () => {
    const gifts = normalizeGifts([
        { id: 1, name: 'Oculto', diamond_count: 10, is_displayed_on_panel: false, image: { url_list: ['https://a/1.png'] } },
        { id: 2, name: 'Gratis', diamond_count: 0, image: { url_list: ['https://a/2.png'] } },
        { id: 3, name: '', diamond_count: 5, image: { url_list: ['https://a/3.png'] } },
        { id: 4, name: 'Sin imagen', diamond_count: 5 },
        { id: 5, name: 'Inseguro', diamond_count: 5, image: { url_list: ['http://a/5.png'] } },
        { id: 6, name: 'Válido', diamond_count: 5, image: { url_list: ['https://a/6.png'] } },
        { id: 6, name: 'Válido', diamond_count: 5, image: { url_list: ['https://a/6.png'] } },
        null
    ]);

    assert.deepEqual(gifts.map(g => g.name), ['Válido']);
});

test('Una respuesta rara de TikTok no rompe nada', () => {
    assert.deepEqual(normalizeGifts(undefined), []);
    assert.deepEqual(normalizeGifts({ gifts: 'x' }), []);
});

/* La economía REAL: el catálogo por defecto y su regla de desbloqueo. */
const CATALOG = createCatalog();
const MENU = menuServices(CATALOG);
const unlocks = coins => resolveService(CATALOG, coins);
const byId = id => CATALOG.find(service => service.id === id);

test('Cada servicio se muestra con el regalo más barato que lo desbloquea', () => {
    const gifts = normalizeGifts(RAW);

    assert.equal(giftForService(byId('oraculo_dia'), gifts, unlocks).name, 'Doughnut', '29 → Doughnut (30)');
    assert.equal(giftForService(byId('lectura_3'), gifts, unlocks).name, 'Corgi', 'Sunglasses (199) no alcanza los 200');
    assert.equal(giftForService(byId('prioridad_3'), gifts, unlocks).name, 'Money Gun');
});

test('Quien envía el regalo mostrado recibe EXACTAMENTE ese servicio', () => {
    const gifts = normalizeGifts(RAW);

    for (const service of MENU) {
        const gift = giftForService(service, gifts, unlocks);

        if (gift) {
            assert.equal(
                unlocks(gift.coins).id,
                service.id,
                `${gift.name} (${gift.coins}) debe dar ${service.label}`
            );
        }
    }
});

test('Nunca promete un servicio que el regalo no da', () => {
    const gifts = normalizeGifts(RAW);

    /*
     * Pregunta Rápida (270) es de nivel menor que Lectura 3 Cartas (200):
     * cualquier regalo de 270+ ya da la lectura. Mostrar el Corgi en esa
     * fila sería mentir, así que queda con su ícono.
     */
    assert.equal(giftForService(byId('pregunta_rapida'), gifts, unlocks), null);
});

test('Sin regalo que alcance, o servicio gratis, no se inventa uno', () => {
    const gifts = normalizeGifts(RAW);

    assert.equal(giftForService(byId('prioridad_5'), gifts, unlocks), null, '800 supera al más caro de la sala');
    assert.equal(giftForService(byId('free'), gifts, unlocks), null);
    assert.equal(giftForService(byId('oraculo_dia'), [], unlocks), null);
});

test('El menú decorado conserva el servicio y agrega el regalo real', () => {
    const menu = decorateMenu(MENU, normalizeGifts(RAW), unlocks);
    const oraculo = menu.find(service => service.id === 'oraculo_dia');

    assert.equal(oraculo.coins, 29, 'el costo del servicio no cambia');
    assert.deepEqual(oraculo.tiktokGift, {
        name: 'Doughnut',
        image: 'https://p16-webcast.tiktokcdn.com/donut.png',
        coins: 30
    });

    assert.equal(menu.find(service => service.id === 'prioridad_5').tiktokGift, undefined);
    assert.equal(byId('oraculo_dia').tiktokGift, undefined, 'no modifica el catálogo original');
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de regalos de la sala superadas correctamente.`
);
