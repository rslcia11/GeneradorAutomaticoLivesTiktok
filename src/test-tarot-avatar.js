import assert from 'node:assert/strict';

/*
 * DOM mínimo para usar TarotAvatar en Node.
 * TarotAvatar solo accede a estos globals al construirse.
 */
class FakeElement {
    constructor() {
        this.classes = new Set();

        this.classList = {
            add: name => this.classes.add(name),
            remove: name => this.classes.delete(name)
        };

        this.dataset = {};
        this.textContent = '';
    }

    dispatchEvent() {
        return true;
    }
}

globalThis.HTMLElement = FakeElement;
globalThis.HTMLImageElement = class extends FakeElement {};

globalThis.window = {
    matchMedia: () => ({ matches: false })
};

const { TarotAvatar } = await import('./overlay/TarotAvatar.js');

const { STATES } = TarotAvatar;

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;

    const avatar = new TarotAvatar({
        root: new FakeElement(),
        image: new globalThis.HTMLImageElement(),
        statusElement: new FakeElement()
    });

    try {
        await fn(avatar);
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    } finally {
        avatar.destroy();
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// 1. BUG 2: timer de speaking no pisa THINKING
await test('Timer de speaking no devuelve a idle durante THINKING', async avatar => {
    avatar.startSpeaking({ durationMs: 30 });
    avatar.listen('usuario');
    avatar.think();

    await sleep(60);

    assert.equal(avatar.state, STATES.THINKING);
});


// 2. BUG 2: timer de reacción no corta SPEAKING
await test('Timer de reacción no corta SPEAKING', async avatar => {
    avatar.react({ durationMs: 30 });
    avatar.startSpeaking();

    await sleep(60);

    assert.equal(avatar.state, STATES.SPEAKING);
});


// 3. BUG 2: timer de speaking no corta una reacción posterior
await test('Timer de speaking no corta REACTING posterior', async avatar => {
    avatar.startSpeaking({ durationMs: 30 });
    avatar.react({ durationMs: 200 });

    await sleep(60);

    assert.equal(avatar.state, STATES.REACTING);
});


// 4. setState directo también cancela timers
await test('setState() cancela timers pendientes', async avatar => {
    avatar.react({ durationMs: 30 });
    avatar.setState(STATES.REACTING, { status: 'fallo' });

    await sleep(60);

    assert.equal(avatar.state, STATES.REACTING);
});


// 5. Sin regresión: speaking con duración vuelve a idle
await test('Speaking con duración vuelve a idle', async avatar => {
    avatar.startSpeaking({ durationMs: 20 });

    await sleep(50);

    assert.equal(avatar.state, STATES.IDLE);
});


// 6. Sin regresión: react vuelve a idle
await test('react() vuelve a idle al terminar', async avatar => {
    avatar.react({ durationMs: 20 });

    assert.equal(avatar.state, STATES.REACTING);

    await sleep(50);

    assert.equal(avatar.state, STATES.IDLE);
});


// 7. Speaking sin duración se mantiene
await test('Speaking sin duración se mantiene hasta stopSpeaking()', async avatar => {
    avatar.startSpeaking();

    await sleep(30);

    assert.equal(avatar.state, STATES.SPEAKING);

    avatar.stopSpeaking();

    assert.equal(avatar.state, STATES.IDLE);
});


// 8. Clases CSS
await test('Aplica una sola clase de estado', async avatar => {
    avatar.think();
    avatar.startSpeaking();

    assert.equal(avatar.root.classes.has('avatar--speaking'), true);
    assert.equal(avatar.root.classes.has('avatar--thinking'), false);
    assert.equal(avatar.root.dataset.avatarState, STATES.SPEAKING);
});


// 9. destroy
await test('destroy() cancela timers y bloquea cambios', async avatar => {
    avatar.react({ durationMs: 20 });
    avatar.destroy();

    await sleep(50);

    assert.equal(avatar.state, STATES.REACTING);
    assert.equal(avatar.root.classes.size, 0);
});


// 9b. celebrate no cambia el estado
await test('celebrate() emite evento sin cambiar el estado', async avatar => {
    const events = [];

    avatar.root.dispatchEvent = event => {
        events.push(event);
        return true;
    };

    avatar.startSpeaking();
    avatar.celebrate('follow');

    assert.equal(avatar.state, STATES.SPEAKING);

    const celebration = events.find(event => event.type === 'avatarcelebrate');

    assert.equal(celebration?.detail.kind, 'follow');
});


// Intención actual (el renderer animado la lee al crearse)
await test('Guarda la intención al hablar y la limpia al cambiar de estado', async avatar => {
    assert.equal(avatar.intent, null);

    avatar.startSpeaking({ intent: 'tarot_reading' });
    assert.equal(avatar.intent, 'tarot_reading');

    avatar.idle();
    assert.equal(avatar.intent, null);
});


// 10. Estado inválido
await test('Estado inválido lanza error', async avatar => {
    assert.throws(
        () => avatar.setState('bailando'),
        /inválido/
    );
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de TarotAvatar superadas correctamente.`
);
