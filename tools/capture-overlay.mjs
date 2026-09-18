/**
 * Captura el overlay en varias pantallas, sin tocar el LIVE real.
 *
 *   node tools/capture-overlay.mjs
 *   node tools/capture-overlay.mjs --screens=obs,celular
 *
 * Abre Chrome sin ventana, carga el overlay con datos de ejemplo (menú,
 * donantes, contacto, un comentario) y guarda un PNG por pantalla en
 * `tools/capturas/`. Sirve para comprobar que un cambio de CSS se ve bien
 * en OBS, en un celular y en un monitor horizontal, que es donde se rompía.
 *
 * ⚠️ Reemplaza `WebSocket` ANTES de cargar la página: si no, el navegador
 * de prueba se conecta al backend real (`ws://127.0.0.1:8080`) y se mete en
 * el LIVE del streamer. La captura debe decir "Conectando..." o
 * "Desconectado", nunca "LIVE conectado".
 *
 * Requiere Chrome. Si no está en la ruta por defecto:
 *   CHROME_PATH="C:/ruta/chrome.exe" node tools/capture-overlay.mjs
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = fileURLToPath(new URL('./capturas/', import.meta.url));

const CHROME = process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DEBUG_PORT = Number(process.env.CDP_PORT) || 9350;
const HTTP_PORT = Number(process.env.OVERLAY_PORT) || 5599;

/* El formato real (OBS) y las dos pantallas donde antes se rompía. */
const SCREENS = {
    obs: { width: 1080, height: 1920 },
    celular: { width: 390, height: 844 },
    monitor: { width: 1365, height: 648 }
};

/* Se espera a que la franja de contacto salga sola (15 s). */
const CONTACT_WAIT_MS = 16_000;

const WS_GUARD = `
    window.WebSocket = class {
        constructor() {
            this.readyState = 3;
            setTimeout(() => {
                this.onerror?.(new Event('error'));
                this.onclose?.({ code: 1006, reason: 'captura' });
            }, 0);
        }
        send() {} close() {} addEventListener() {} removeEventListener() {}
    };
`;

/* Imágenes de ejemplo: en el LIVE llegan del CDN de TikTok. */
const GIFT = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/';

const SAMPLE = `
    const send = window.overlayDebug.handleEvent;

    send({ type: 'service_menu', services: [
        { id: 'oraculo_dia', label: 'Oráculo del Día', coins: 29, style: 'short',
          tiktokGift: { name: 'Doughnut', coins: 30, image: '${GIFT}1f369.png' } },
        { id: 'lectura_3', label: 'Lectura 3 Cartas', coins: 200, style: 'reading',
          tiktokGift: { name: 'Corgi', coins: 299, image: '${GIFT}1f415.png' } },
        { id: 'pregunta_rapida', label: 'Pregunta Rápida', coins: 270, style: 'full' },
        { id: 'prioridad_3', label: 'Prioridad 3 Cartas', coins: 500, style: 'reading',
          tiktokGift: { name: 'Money Gun', coins: 500, image: '${GIFT}1f52b.png' } },
        { id: 'prioridad_5', label: 'Prioridad 5 Cartas', coins: 800, style: 'reading_long' }
    ]});

    send({ type: 'donor_board', donors: [
        { username: 'luna', nickname: 'Luna', gift: 'Doughnut', image: '${GIFT}1f369.png', coins: 30 },
        { username: 'bladis', nickname: 'Bladis', gift: 'Rose', image: '${GIFT}1f339.png', coins: 5 },
        { username: 'danna', nickname: 'Danna', gift: 'Heart Me', coins: 1 },
        { username: 'edu', nickname: 'Edu', gift: 'Perfume', image: '${GIFT}1f9f4.png', coins: 20 },
        { username: 'mara', nickname: 'Mara', gift: 'Rose', image: '${GIFT}1f339.png', coins: 1 }
    ]});

    send({ type: 'contact_banner', contact: {
        enabled: true,
        text: '✨ ¿Consulta personalizada? Escríbeme al 09XXXXXXXX',
        visibleSeconds: 12,
        everyMinutes: 6
    }});

    send({ type: 'comment', user: { nickname: 'Mayra' }, content: '¿encontraré trabajo pronto?' });
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const wanted = (process.argv.find(arg => arg.startsWith('--screens=')) ?? '')
    .replace('--screens=', '')
    .split(',')
    .filter(Boolean);

const screens = Object.entries(SCREENS)
    .filter(([name]) => wanted.length === 0 || wanted.includes(name));

await mkdir(OUT, { recursive: true });

const server = spawn(process.execPath, [`${ROOT}scripts/serve-overlay.js`], {
    env: { ...process.env, OVERLAY_PORT: String(HTTP_PORT) },
    stdio: 'ignore'
});

const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${OUT}chrome-perfil`,
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    'about:blank'
], { stdio: 'ignore' });

let targets = [];

for (let attempt = 0; attempt < 50; attempt++) {
    try {
        targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();

        if (targets.some(target => target.type === 'page')) {
            break;
        }
    } catch {
        /* Chrome todavía está arrancando. */
    }

    await sleep(200);
}

const page = targets.find(target => target.type === 'page');

if (!page) {
    console.error(`❌ No se pudo abrir Chrome (${CHROME}). Define CHROME_PATH.`);
    chrome.kill();
    server.kill();
    process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);

await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));

let lastId = 0;
const pending = new Map();
const problems = [];

socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);

    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
        return;
    }

    if (message.method === 'Runtime.exceptionThrown') {
        problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
});

const send = (method, params = {}) => new Promise(resolve => {
    const id = ++lastId;

    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async expression =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
        .result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: WS_GUARD });

for (const [name, size] of screens) {

    await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html?avatar=animado&debug=1` });

    let ready = null;

    for (let attempt = 0; attempt < 100; attempt++) {
        await sleep(200);
        ready = await evaluate(`document.getElementById('avatar')?.dataset.animatedAvatar ?? null`);

        if (ready) {
            break;
        }
    }

    await evaluate(SAMPLE);
    await sleep(CONTACT_WAIT_MS);

    const state = await evaluate(`JSON.stringify({
        conexion: document.getElementById('connection-status').textContent.trim(),
        escala: getComputedStyle(document.documentElement).getPropertyValue('--stage-scale').trim(),
        contactoVisible: !document.getElementById('contact-banner').hidden
    })`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });

    await writeFile(`${OUT}${name}-${size.width}x${size.height}.png`, Buffer.from(shot.result.data, 'base64'));

    console.log(`📸 ${name} (${size.width}×${size.height}) → ${state}`);
}

console.log(problems.length > 0 ? `\n❌ Errores:\n${problems.join('\n')}` : '\n✅ Sin errores en la página.');
console.log(`Capturas en ${OUT}`);

socket.close();
chrome.kill();
server.kill();
process.exit(0);
