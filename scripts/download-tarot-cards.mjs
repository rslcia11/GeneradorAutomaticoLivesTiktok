/**
 * Descarga los 22 arcanos mayores Rider-Waite desde Wikimedia Commons.
 * Rider-Waite (1909) es dominio público.
 *
 * Uso: node scripts/download-tarot-cards.mjs
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'src', 'overlay', 'assets', 'tarot');

await mkdir(DEST, { recursive: true });

/* Special:FilePath resuelve el hash automáticamente y redirige al archivo real. */
const BASE = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

const CARDS = [
    { slug: 'fool',             file: 'RWS_Tarot_00_Fool.jpg' },
    { slug: 'magician',         file: 'RWS_Tarot_01_Magician.jpg' },
    { slug: 'high-priestess',   file: 'RWS_Tarot_02_High_Priestess.jpg' },
    { slug: 'empress',          file: 'RWS_Tarot_03_Empress.jpg' },
    { slug: 'emperor',          file: 'RWS_Tarot_04_Emperor.jpg' },
    { slug: 'hierophant',       file: 'RWS_Tarot_05_Hierophant.jpg' },
    { slug: 'lovers',           file: 'RWS_Tarot_06_Lovers.jpg' },
    { slug: 'chariot',          file: 'RWS_Tarot_07_Chariot.jpg' },
    { slug: 'strength',         file: 'RWS_Tarot_08_Strength.jpg' },
    { slug: 'hermit',           file: 'RWS_Tarot_09_Hermit.jpg' },
    { slug: 'wheel-of-fortune', file: 'RWS_Tarot_10_Wheel_of_Fortune.jpg' },
    { slug: 'justice',          file: 'RWS_Tarot_11_Justice.jpg' },
    { slug: 'hanged-man',       file: 'RWS_Tarot_12_Hanged_Man.jpg' },
    { slug: 'death',            file: 'RWS_Tarot_13_Death.jpg' },
    { slug: 'temperance',       file: 'RWS_Tarot_14_Temperance.jpg' },
    { slug: 'devil',            file: 'RWS_Tarot_15_Devil.jpg' },
    { slug: 'tower',            file: 'RWS_Tarot_16_Tower.jpg' },
    { slug: 'star',             file: 'RWS_Tarot_17_Star.jpg' },
    { slug: 'moon',             file: 'RWS_Tarot_18_Moon.jpg' },
    { slug: 'sun',              file: 'RWS_Tarot_19_Sun.jpg' },
    { slug: 'judgement',        file: 'RWS_Tarot_20_Judgement.jpg' },
    { slug: 'world',            file: 'RWS_Tarot_21_World.jpg' },
];

const delay = ms => new Promise(r => setTimeout(r, ms));

async function download(card, retries = 2) {
    const url = BASE + encodeURIComponent(card.file);
    const dest = join(DEST, `${card.slug}.jpg`);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                redirect: 'follow',
                headers: { 'User-Agent': 'TarotLiveBot/1.0 (educational; node-fetch)' }
            });

            if (res.status === 429) {
                const wait = attempt * 3000;
                process.stdout.write(`(429, reintentando en ${wait / 1000}s) `);
                await delay(wait);
                continue;
            }

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            await pipeline(res.body, createWriteStream(dest));
            return true;
        } catch (err) {
            if (attempt === retries) {
                throw err;
            }
            await delay(1500);
        }
    }
    return false;
}

let ok = 0;
let fail = 0;

for (const card of CARDS) {
    process.stdout.write(`${card.slug}... `);

    try {
        await download(card);
        console.log('✅');
        ok++;
    } catch (err) {
        console.log(`❌ ${err.message}`);
        fail++;
    }

    /* Pausa entre peticiones para evitar rate-limit. */
    await delay(800);
}

console.log(`\n${ok} descargadas, ${fail} fallidas. Imágenes en src/overlay/assets/tarot/`);
