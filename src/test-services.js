import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLedgerSaver, loadLedger } from './rules/ledgerStore.js';

import {
    DEFAULT_SERVICES,
    createCatalog,
    menuServices,
    resolveService
} from './rules/serviceCatalog.js';

import { SupportLedger } from './rules/SupportLedger.js';
import { ServicePolicy } from './rules/ServicePolicy.js';
import { EventRuleEngine } from './rules/EventRuleEngine.js';
import { applyServiceIntent } from './ai/intents.js';

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

const HOUR = 60 * 60 * 1000;

/* Reloj controlado: podemos "viajar" 24 h sin esperar. */
function createClock(start = 1_700_000_000_000) {
    let now = start;

    return {
        now: () => now,
        advanceHours(hours) {
            now += hours * HOUR;
        }
    };
}

const comment = (id, content = 'Una pregunta del día') => ({
    type: 'comment',
    user: { id, username: `user${id}` },
    content
});

const gift = (id, diamondCount, repeatCount = 1) => ({
    type: 'gift',
    user: { id, username: `user${id}` },
    gift: { name: 'Regalo', diamondCount, repeatCount, repeatEnd: 1 }
});


/* ============================================================
   1. Catálogo
   ============================================================ */

test('El catálogo por defecto trae los servicios del LIVE y uno gratis', () => {
    const catalog = createCatalog();
    const ids = catalog.map(service => service.id);

    assert.ok(ids.includes('free'));

    for (const id of ['oraculo_dia', 'lectura_3', 'pregunta_rapida', 'prioridad_3', 'prioridad_5']) {
        assert.ok(ids.includes(id), `falta ${id}`);
    }
});

test('resolveService entrega el mejor nivel que el apoyo alcance', () => {
    const catalog = createCatalog();

    assert.equal(resolveService(catalog, 0).id, 'free');
    assert.equal(resolveService(catalog, 28).id, 'free');
    assert.equal(resolveService(catalog, 29).id, 'oraculo_dia');
    assert.equal(resolveService(catalog, 199).id, 'oraculo_dia');
    assert.equal(resolveService(catalog, 200).id, 'lectura_3');
    assert.equal(resolveService(catalog, 500).id, 'prioridad_3');
    assert.equal(resolveService(catalog, 5000).id, 'prioridad_5');
});

test('Regalar de más nunca da una respuesta peor (270 sigue dando lectura)', () => {
    const catalog = createCatalog();

    /* "Pregunta Rápida" cuesta 270 pero vale menos que la lectura de 200. */
    const service = resolveService(catalog, 270);

    assert.equal(service.id, 'lectura_3');
    assert.ok(service.level >= catalog.find(s => s.id === 'pregunta_rapida').level);
});

test('El menú se ordena por precio y excluye el nivel gratis', () => {
    const menu = menuServices(createCatalog());

    assert.deepEqual(menu.map(service => service.coins), [29, 200, 270, 500, 800]);
    assert.ok(menu.every(service => service.coins > 0));
});

test('Un catálogo mal configurado falla al iniciar, no en pleno LIVE', () => {
    assert.throws(() => createCatalog([]), /vacío/);
    assert.throws(() => createCatalog([{ ...DEFAULT_SERVICES[1] }]), /gratis/);

    assert.throws(
        () => createCatalog([DEFAULT_SERVICES[0], { ...DEFAULT_SERVICES[1], style: 'inventado' }]),
        /Estilo/
    );

    assert.throws(
        () => createCatalog([DEFAULT_SERVICES[0], { ...DEFAULT_SERVICES[1], coins: -5 }]),
        /coins/
    );

    assert.throws(
        () => createCatalog([DEFAULT_SERVICES[0], DEFAULT_SERVICES[0]]),
        /duplicado/
    );
});


/* ============================================================
   2. Memoria de 24 horas
   ============================================================ */

test('Los regalos se suman al saldo', () => {
    const clock = createClock();
    const ledger = new SupportLedger({ now: clock.now });

    ledger.recordGift('u1', 1);
    ledger.recordGift('u1', 1);
    assert.equal(ledger.balanceOf('u1'), 2);

    clock.advanceHours(10);
    assert.equal(ledger.recordGift('u1', 30), 32);
});

test('El saldo se gasta y lo que sobra queda para la próxima', () => {
    const ledger = new SupportLedger();

    ledger.recordGift('u1', 270);

    assert.equal(ledger.spend('u1', 200), 70);
    assert.equal(ledger.balanceOf('u1'), 70);

    /* No queda en negativo aunque el servicio cueste más. */
    assert.equal(ledger.spend('u1', 500), 0);
    assert.equal(ledger.spend('u1', 100), 0);
});

test('El saldo sin usar caduca a las 24 h (y el registro se limpia solo)', () => {
    const clock = createClock();
    const ledger = new SupportLedger({ now: clock.now });

    ledger.recordGift('u1', 200);

    clock.advanceHours(23);
    assert.equal(ledger.balanceOf('u1'), 200);

    clock.advanceHours(2);
    assert.equal(ledger.balanceOf('u1'), 0);

    ledger.recordGift('u2', 5);
    assert.equal(ledger.size, 1, 'el usuario vencido debe desaparecer');
});

test('La respuesta gratis es una cada 24 h por persona', () => {
    const clock = createClock();
    const ledger = new SupportLedger({ now: clock.now });

    assert.equal(ledger.canUseFree('u1', 24), true);

    ledger.useFree('u1');
    assert.equal(ledger.canUseFree('u1', 24), false);
    assert.ok(Math.abs(ledger.hoursUntilFree('u1', 24) - 24) < 0.01);

    clock.advanceHours(23);
    assert.equal(ledger.canUseFree('u1', 24), false);

    clock.advanceHours(1.5);
    assert.equal(ledger.canUseFree('u1', 24), true);
    assert.equal(ledger.hoursUntilFree('u1', 24), 0);
});

test('Se guarda y se recupera igual entre reinicios', () => {
    const clock = createClock();
    const ledger = new SupportLedger({ now: clock.now });

    ledger.recordGift('u1', 200);
    ledger.useFree('u2');

    const copy = SupportLedger.fromJSON(
        JSON.parse(JSON.stringify(ledger.toJSON())),
        { now: clock.now }
    );

    assert.equal(copy.balanceOf('u1'), 200);
    assert.equal(copy.canUseFree('u2', 24), false);
});

test('Ignora regalos inválidos y limita cuántos usuarios recuerda', () => {
    const ledger = new SupportLedger({ maxUsers: 3 });

    assert.equal(ledger.recordGift(null, 10), 0);
    assert.equal(ledger.recordGift('u1', -5), 0);
    assert.equal(ledger.recordGift('u1', 'mucho'), 0);

    for (let i = 0; i < 10; i++) {
        ledger.recordGift(`user-${i}`, 1);
    }

    assert.equal(ledger.size, 3);
});


/* ============================================================
   3. Política de servicios
   ============================================================ */

test('Sin apoyo: primera pregunta sí, segunda no, y al día siguiente otra vez sí', () => {
    const clock = createClock();
    const policy = new ServicePolicy({ ledger: new SupportLedger({ now: clock.now }) });

    const first = policy.evaluateComment(comment('u1'));
    assert.equal(first.allowed, true);
    assert.equal(first.service.style, 'yes_no');

    const second = policy.evaluateComment(comment('u1'));
    assert.equal(second.allowed, false);
    assert.equal(second.reason, 'free_quota_used');
    assert.ok(second.hoursUntilFree > 23);

    clock.advanceHours(25);
    assert.equal(policy.evaluateComment(comment('u1')).allowed, true);
});

test('Quien regala recibe SU lectura esa vez, no lecturas ilimitadas', () => {
    const policy = new ServicePolicy();

    policy.registerGift(gift('u1', 200));

    const paid = policy.evaluateComment(comment('u1'));

    assert.equal(paid.service.id, 'lectura_3');
    assert.equal(paid.service.cards, true);
    assert.equal(paid.remaining, 0);

    /* La siguiente pregunta ya es del nivel gratis. */
    const next = policy.evaluateComment(comment('u1'));

    assert.equal(next.service.id, 'free');
    assert.equal(next.allowed, true, 'la gratis del día sigue disponible');

    /* Y la tercera, sin saldo y sin gratis, se rechaza. */
    assert.equal(policy.evaluateComment(comment('u1')).allowed, false);
});

test('Lo que sobra del regalo sirve para la siguiente pregunta', () => {
    const policy = new ServicePolicy();

    policy.registerGift(gift('u1', 270));

    const first = policy.evaluateComment(comment('u1'));

    assert.equal(first.service.id, 'lectura_3');
    assert.equal(first.remaining, 70);

    const second = policy.evaluateComment(comment('u1'));

    assert.equal(second.service.id, 'oraculo_dia', 'con 70 aún alcanza el Oráculo');
    assert.equal(second.remaining, 41);
});

test('El saldo sin usar caduca a las 24 h', () => {
    const clock = createClock();
    const policy = new ServicePolicy({ ledger: new SupportLedger({ now: clock.now }) });

    policy.registerGift(gift('u1', 800));

    clock.advanceHours(25);

    assert.equal(policy.evaluateComment(comment('u1')).service.id, 'free');
});

test('Un regalo repetido cuenta por su total (5 rosas = 5 monedas)', () => {
    const policy = new ServicePolicy();

    assert.equal(ServicePolicy.giftCoins(gift('u1', 1, 5)), 5);
    assert.equal(ServicePolicy.giftCoins({ type: 'gift' }), 0);

    const result = policy.registerGift(gift('u1', 29, 1));

    assert.equal(result.coins, 29);
    assert.equal(result.service.id, 'oraculo_dia');
});

test('Regalos pequeños acumulados desbloquean el siguiente nivel', () => {
    const policy = new ServicePolicy();

    policy.registerGift(gift('u1', 20));
    assert.equal(policy.evaluateComment(comment('u1')).service.id, 'free');

    policy.registerGift(gift('u1', 10));
    assert.equal(policy.evaluateComment(comment('u1')).service.id, 'oraculo_dia');
});

test('Un combo en curso NO suma: solo cuenta el envío final', () => {
    const policy = new ServicePolicy();

    const combo = (repeatCount, repeatEnd) => ({
        type: 'gift',
        user: { id: 'u1' },
        gift: { name: 'Rose', diamondCount: 1, repeatCount, repeatEnd, combo: true }
    });

    /* 10 rosas: 9 eventos intermedios + el final con el total. */
    for (let i = 1; i < 10; i++) {
        assert.equal(policy.registerGift(combo(i, 0)).counted, false);
    }

    const final = policy.registerGift(combo(10, 1));

    assert.equal(final.counted, true);
    assert.equal(final.balance, 10, 'no debe sumar 55');
});

test('Si la respuesta no se entrega, se devuelve lo cobrado', () => {
    const policy = new ServicePolicy();
    const event = comment('u1');

    policy.registerGift(gift('u1', 200));

    const decision = policy.evaluateComment(event);

    assert.equal(decision.remaining, 0);

    policy.refund({ service: decision.service, event });

    /* Puede volver a pedir su lectura. */
    assert.equal(policy.evaluateComment(event).service.id, 'lectura_3');
});

test('También se devuelve la respuesta gratis del día', () => {
    const policy = new ServicePolicy();
    const event = comment('u1');

    const decision = policy.evaluateComment(event);

    assert.equal(policy.evaluateComment(event).allowed, false);

    policy.refund({ service: decision.service, event });

    assert.equal(policy.evaluateComment(event).allowed, true);
});

test('Agradecer un regalo usa un estilo breve, no el de la lectura comprada', () => {
    const policy = new ServicePolicy();

    policy.registerGift(gift('u1', 800));

    const thanks = policy.evaluateGift(gift('u1', 800));

    assert.equal(thanks.service.style, 'short');
    assert.equal(thanks.service.cards, false);
    assert.equal(thanks.unlocked.id, 'prioridad_5', 'sí sabe qué desbloqueó');

    /* Y la lectura sigue disponible para su pregunta. */
    assert.equal(policy.evaluateComment(comment('u1')).service.id, 'prioridad_5');
});

test('Avisa de cada cambio de saldo para poder guardarlo', () => {
    let changes = 0;

    const policy = new ServicePolicy({ onChange: () => changes++ });

    policy.registerGift(gift('u1', 200));
    policy.evaluateComment(comment('u1'));
    policy.refund({ service: { level: 3, coins: 200 }, event: comment('u1') });

    assert.equal(changes, 3);
});

test('Una gratis más larga que la memoria del registro se rechaza al iniciar', () => {
    const catalog = createCatalog([
        { ...DEFAULT_SERVICES[0], freeEveryHours: 48 },
        DEFAULT_SERVICES[1]
    ]);

    assert.throws(() => new ServicePolicy({ catalog }), /no puede durar/);
});

test('Las estadísticas distinguen gratis, rechazadas y con apoyo', () => {
    const policy = new ServicePolicy();

    policy.evaluateComment(comment('u1'));
    policy.evaluateComment(comment('u1'));
    policy.registerGift(gift('u2', 300));
    policy.evaluateComment(comment('u2'));

    assert.deepEqual(policy.getStats(), {
        freeGranted: 1,
        freeRejected: 1,
        paidGranted: 1,
        refunded: 0,
        trackedUsers: 2
    });
});


/* ============================================================
   4. Lo pagado manda sobre las cartas
   ============================================================ */

test('Un servicio con cartas siempre muestra cartas, diga lo que diga la IA', () => {
    const conCartas = { cards: true };

    for (const intent of ['comment', 'invite_share', 'tarot_reading']) {
        assert.equal(applyServiceIntent(intent, conCartas), 'tarot_reading');
    }
});

test('Una respuesta sin cartas nunca las saca', () => {
    const sinCartas = { cards: false };

    assert.equal(applyServiceIntent('tarot_reading', sinCartas), 'comment');
    assert.equal(applyServiceIntent('invite_share', sinCartas), 'invite_share');
    assert.equal(applyServiceIntent('comment', sinCartas), 'comment');
});

test('Agradecer un regalo no cambia nunca (aunque el servicio tenga cartas)', () => {
    assert.equal(applyServiceIntent('thanks', { cards: true }), 'thanks');
    assert.equal(applyServiceIntent('thanks', { cards: false }), 'thanks');
});

test('Sin servicio, la intención del modelo se respeta', () => {
    assert.equal(applyServiceIntent('tarot_reading', null), 'tarot_reading');
    assert.equal(applyServiceIntent('comment', undefined), 'comment');
});

test('Los servicios del catálogo activan cartas solo en las lecturas', () => {
    const catalog = createCatalog();
    const byId = id => catalog.find(service => service.id === id);

    assert.equal(byId('free').cards, false);
    assert.equal(byId('oraculo_dia').cards, false);
    assert.equal(byId('pregunta_rapida').cards, false);
    assert.equal(byId('lectura_3').cards, true);
    assert.equal(byId('prioridad_5').cards, true);
});


/* ============================================================
   5. Integración con el motor de reglas
   ============================================================ */

test('El motor ignora la segunda pregunta gratis: nunca llega a la IA', () => {
    const policy = new ServicePolicy();
    const engine = new EventRuleEngine({ policy });

    assert.equal(engine.evaluate(comment('u1')).action, 'queue');

    const second = engine.evaluate(comment('u1'));

    assert.equal(second.action, 'ignore');
    assert.equal(second.reason, 'free_quota_used');
});

test('El motor da más prioridad a quien apoya más', () => {
    const policy = new ServicePolicy();
    const engine = new EventRuleEngine({ policy });

    policy.registerGift(gift('rico', 800));
    policy.registerGift(gift('normal', 29));

    const rico = engine.evaluate(comment('rico'));
    const normal = engine.evaluate(comment('normal'));
    const gratis = engine.evaluate(comment('nuevo'));

    assert.ok(rico.priority > normal.priority);
    assert.ok(normal.priority > gratis.priority);
    assert.equal(rico.metadata.service.id, 'prioridad_5');
});

test('Un regalo pequeño nunca pierde prioridad frente a un comentario', () => {
    const policy = new ServicePolicy();
    const engine = new EventRuleEngine({ policy });

    const smallGift = gift('nuevo', 1);

    policy.registerGift(smallGift);

    const giftDecision = engine.evaluate(smallGift);
    const commentDecision = engine.evaluate(comment('otro'));

    assert.ok(giftDecision.priority >= 80);
    assert.ok(giftDecision.priority > commentDecision.priority);
});

test('El registro expulsa a los inactivos, no a los donantes fieles', () => {
    const clock = createClock();
    const ledger = new SupportLedger({ now: clock.now, maxUsers: 2 });

    ledger.recordGift('fiel', 500);

    clock.advanceHours(1);
    ledger.recordGift('viejo', 5);

    clock.advanceHours(1);
    ledger.recordGift('fiel', 5);

    /* Entra uno nuevo con el registro lleno. */
    ledger.recordGift('nuevo', 1);

    assert.equal(ledger.balanceOf('fiel'), 505, 'el fiel conserva su saldo');
    assert.equal(ledger.balanceOf('viejo'), 0, 'el inactivo es el que sale');
    assert.equal(ledger.balanceOf('nuevo'), 1);
});

test('Sin política configurada, el motor se comporta como antes', () => {
    const engine = new EventRuleEngine();

    const first = engine.evaluate(comment('u1'));
    const second = engine.evaluate(comment('u1'));

    assert.equal(first.action, 'queue');
    assert.equal(second.action, 'queue');
    assert.equal(first.priority, 50);
});


/* ============================================================
   6. Guardado en disco
   ============================================================ */

const tempDir = await mkdtemp(join(tmpdir(), 'ledger-test-'));

try {
    total++;

    const path = join(tempDir, 'support.json');
    const ledger = new SupportLedger();

    ledger.recordGift('u1', 200);

    const saver = createLedgerSaver({ path, ledger, delayMs: 5 });

    saver.schedule();

    /* Cerrar la app no debe perder el último regalo. */
    await saver.flush();

    const restored = await loadLedger(path);

    assert.equal(restored.balanceOf('u1'), 200);

    /* Un archivo inexistente arranca vacío, sin romper. */
    const fresh = await loadLedger(join(tempDir, 'no-existe.json'));

    assert.equal(fresh.size, 0);
    assert.deepEqual(await readdir(tempDir), ['support.json'], 'sin archivos .tmp sueltos');

    passed++;
    console.log('✅ El saldo se guarda al cerrar y se recupera al arrancar');

} catch (error) {
    console.error('❌ El saldo se guarda al cerrar y se recupera al arrancar');
    throw error;

} finally {
    await rm(tempDir, { recursive: true, force: true });
}


console.log(
    `\n🎯 ${passed}/${total} pruebas de servicios y apoyo superadas correctamente.`
);
