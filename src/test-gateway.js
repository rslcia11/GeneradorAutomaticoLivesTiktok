import assert from 'node:assert/strict';
import { connect as connectTcp } from 'node:net';

/* Cliente de `ws`, no el global: el CI corre Node 20, que no lo trae. */
import { WebSocket } from 'ws';

import { RealtimeGateway, MAX_CLIENTS } from './realtime/RealtimeGateway.js';
import { generateAccessKey, keyMatches, resolveAccessKey } from './realtime/accessKey.js';
import { CONTENT_SECURITY_POLICY, resolveOverlayFile } from './realtime/overlayStatic.js';
import { socketUrl } from './overlay/socketUrl.js';

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;

    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

const quiet = { info: () => {}, error: () => {} };

const KEY = generateAccessKey();

/* Gateway en un puerto libre; se cierra al final de cada prueba. */
async function withGateway(options, fn) {
    const gateway = new RealtimeGateway({ port: 0, log: quiet, ...options });

    await gateway.start();

    const base = `http://127.0.0.1:${gateway.address.port}`;

    try {
        await fn({ gateway, base, ws: base.replace('http', 'ws') });
    } finally {
        await gateway.stop();
    }
}

/* Abre un WebSocket y resuelve con el primer mensaje, o rechaza si lo cierran. */
function connect(url, { origin } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, origin ? { origin } : undefined);
        const received = [];

        socket.addEventListener('message', ({ data }) => received.push(JSON.parse(data)));
        socket.addEventListener('error', () => reject(new Error('rechazado')));
        socket.addEventListener('close', () => reject(new Error('cerrado')));

        socket.addEventListener('open', () => {
            /* Deja llegar la bienvenida antes de devolver el socket. */
            setTimeout(() => resolve({ socket, received }), 50);
        });
    });
}


// 1. Clave de acceso
await test('resolveAccessKey: sin clave solo se permite en loopback', () => {
    assert.equal(resolveAccessKey({}, { host: '127.0.0.1' }), null);
    assert.equal(resolveAccessKey({ OVERLAY_KEY: '  ' }, { host: 'localhost' }), null);

    assert.throws(() => resolveAccessKey({}, { host: '0.0.0.0' }), /OVERLAY_KEY es obligatoria/);
});

await test('resolveAccessKey: una clave corta se rechaza; una generada pasa', () => {
    assert.throws(() => resolveAccessKey({ OVERLAY_KEY: 'corta' }), /demasiado corta/);
    assert.equal(resolveAccessKey({ OVERLAY_KEY: ` ${KEY} ` }), KEY);
    assert.ok(KEY.length >= 43);
});

await test('keyMatches: solo la clave exacta; nunca revienta con basura', () => {
    assert.equal(keyMatches(KEY, KEY), true);
    assert.equal(keyMatches(KEY.slice(0, -1), KEY), false);
    assert.equal(keyMatches(`${KEY}x`, KEY), false);
    assert.equal(keyMatches(undefined, KEY), false);
    assert.equal(keyMatches(KEY, null), false);
});

await test('El gateway no arranca expuesto a la red sin clave', () => {
    assert.throws(() => new RealtimeGateway({ host: '0.0.0.0', accessKey: null }), /sin clave/);
});


// 2. Página y archivos
await test('Sin clave configurada (local): la página se sirve y trae cabeceras de seguridad', () =>
    withGateway({}, async ({ base }) => {
        const page = await fetch(`${base}/`);

        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /text\/html/);
        assert.equal(page.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
        assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(page.headers.get('cache-control'), 'no-store');
        assert.match(await page.text(), /<title>/);
    })
);

await test('Con clave: la página exige ?key= exacta; los archivos estáticos no', () =>
    withGateway({ accessKey: KEY }, async ({ base }) => {
        assert.equal((await fetch(`${base}/`)).status, 401);
        assert.equal((await fetch(`${base}/index.html`)).status, 401);
        assert.equal((await fetch(`${base}/?key=${KEY.slice(1)}`)).status, 401);
        assert.equal((await fetch(`${base}/?key=${KEY}`)).status, 200);
        assert.equal((await fetch(`${base}/index.html?avatar=animado&key=${KEY}`)).status, 200);

        const script = await fetch(`${base}/overlay.js`);

        assert.equal(script.status, 200);
        assert.match(script.headers.get('content-type'), /javascript/);
        assert.equal(script.headers.get('content-security-policy'), null, 'la CSP es solo del HTML');
    })
);

await test('Escribir index.html de otra forma no se salta la clave', () =>
    withGateway({ accessKey: KEY }, async ({ base }) => {
        const disguises = [
            '/%2findex.html', '/%2Findex.html', '/.%2findex.html', '/.//index.html',
            '//index.html', '/./index.html', '/%2e/index.html', '/%5cindex.html',
            '/index.html/', '/index.html.', '/index.html::$DATA'
        ];

        for (const path of disguises) {
            const { status } = await fetch(`${base}${path}`);

            assert.ok(status === 400 || status === 401 || status === 404, `${path} → ${status}`);
        }

        /* Petición en forma absoluta, sin pasar por la normalización de fetch. */
        const raw = await new Promise((resolve, reject) => {
            const socket = connectTcp(new URL(base).port, '127.0.0.1', () =>
                socket.end('GET http://x//index.html HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
            let data = '';

            socket.on('data', chunk => { data += chunk; });
            socket.on('end', () => resolve(data));
            socket.on('error', reject);
        });

        assert.doesNotMatch(raw, /^HTTP\/1\.1 200/);
    })
);

await test('Rutas fuera del overlay, métodos raros y URLs rotas no pasan', () =>
    withGateway({}, async ({ base }) => {
        assert.equal(resolveOverlayFile('/../package.json'), null);
        assert.equal((await fetch(`${base}/no-existe.js`)).status, 404);
        assert.equal((await fetch(`${base}/%zz`)).status, 400);
        assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
    })
);

await test('/healthz responde sin clave y solo con lo que le pasan', () =>
    withGateway({ accessKey: KEY, health: () => ({ tiktok: 'connecting' }) }, async ({ base }) => {
        const response = await fetch(`${base}/healthz`);

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, tiktok: 'connecting' });
    })
);


// 3. WebSocket
await test('El socket saluda y manda el estado inicial', () =>
    withGateway({ welcome: () => [{ type: 'service_menu', services: [] }] }, async ({ ws }) => {
        const { socket, received } = await connect(`${ws}/ws`);

        assert.equal(received[0].type, 'system');
        assert.equal(received[0].event, 'connected');
        assert.equal(received[1].type, 'service_menu');

        socket.close();
    })
);

await test('Con clave: el socket se rechaza antes del upgrade sin ?key=', () =>
    withGateway({ accessKey: KEY }, async ({ ws }) => {
        await assert.rejects(connect(`${ws}/ws`));
        await assert.rejects(connect(`${ws}/ws?key=${KEY.slice(1)}`));

        const { socket, received } = await connect(`${ws}/ws?key=${KEY}`);

        assert.equal(received[0].event, 'connected');
        socket.close();
    })
);

await test('Otra ruta no es un WebSocket, y otro origen no puede abrirlo', () =>
    withGateway({}, async ({ ws, base }) => {
        await assert.rejects(connect(`${ws}/`));
        await assert.rejects(connect(`${ws}/ws`, { origin: 'https://otro-sitio.com' }));

        const { socket } = await connect(`${ws}/ws`, { origin: base });

        socket.close();
    })
);

await test('broadcast llega a todos; lo que el overlay envíe se ignora', () =>
    withGateway({}, async ({ gateway, ws }) => {
        const a = await connect(`${ws}/ws`);
        const b = await connect(`${ws}/ws`);

        a.socket.send('{"type":"hack"}');
        gateway.broadcast({ type: 'like', count: 3 });

        await new Promise(resolve => setTimeout(resolve, 50));

        assert.deepEqual(a.received.at(-1), { type: 'like', count: 3 });
        assert.deepEqual(b.received.at(-1), { type: 'like', count: 3 });

        a.socket.close();
        b.socket.close();
    })
);

await test(`Más de ${MAX_CLIENTS} overlays a la vez se rechazan`, () =>
    withGateway({}, async ({ ws }) => {
        const clients = [];

        for (let index = 0; index < MAX_CLIENTS; index++) {
            clients.push(await connect(`${ws}/ws`));
        }

        await assert.rejects(connect(`${ws}/ws`));

        for (const { socket } of clients) {
            socket.close();
        }
    })
);


// 4. Dirección del socket en el navegador
await test('socketUrl: mismo servidor, ruta relativa, ws/wss según la página, con clave', () => {
    const at = href => socketUrl(new URL(href));

    assert.equal(at('http://127.0.0.1:8080/?avatar=animado&key=abc'), 'ws://127.0.0.1:8080/ws?avatar=animado&key=abc');
    assert.equal(at('http://127.0.0.1:8080/index.html?key=abc'), 'ws://127.0.0.1:8080/ws?key=abc');
    assert.equal(at('https://mago.ejemplo.com/beto/?key=abc#x'), 'wss://mago.ejemplo.com/beto/ws?key=abc');
    assert.equal(at('https://mago.ejemplo.com/beto/index.html?key=abc'), 'wss://mago.ejemplo.com/beto/ws?key=abc');
});


console.log(`\n🎯 ${passed}/${total} pruebas del gateway superadas correctamente.`);
