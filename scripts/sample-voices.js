/**
 * Genera muestras de voz de Edge TTS para elegir la del mago.
 *
 *   node scripts/sample-voices.js
 *
 * Los archivos MP3 quedan en samples/voices/.
 * Escúchalos y elige el que suene más a "viejo sabio".
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { EdgeTTS } from 'node-edge-tts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'samples', 'voices');

await mkdir(OUT, { recursive: true });

/* Frase típica del mago — suficientemente larga para notar el timbre */
const TEXTO =
    'Las estrellas revelan tu camino... Hay fuerzas ocultas que trabajan a tu favor, ' +
    'aunque aún no las puedas ver. Ten paciencia, pues el universo conspira por ti.';

/* Voces masculinas en español + variantes de tono en Jorge */
const VOCES = [
    /* Jorge con distintos tonos — busca el más grave y cálido */
    { voz: 'es-MX-JorgeNeural',       pitch: 'default',  etiqueta: 'Jorge-default'    },
    { voz: 'es-MX-JorgeNeural',       pitch: '-10%',     etiqueta: 'Jorge-tono-bajo'  },
    { voz: 'es-MX-JorgeNeural',       pitch: '-20%',     etiqueta: 'Jorge-tono-grave' },
    { voz: 'es-MX-JorgeNeural',       pitch: '-30%',     etiqueta: 'Jorge-muy-grave'  },

    /* Voces masculinas de otros dialectos */
    { voz: 'es-ES-AlvaroNeural',      pitch: 'default',  etiqueta: 'Alvaro-ES'        },
    { voz: 'es-ES-AlvaroNeural',      pitch: '-15%',     etiqueta: 'Alvaro-ES-grave'  },
    { voz: 'es-AR-TomasNeural',       pitch: 'default',  etiqueta: 'Tomas-AR'         },
    { voz: 'es-CO-GonzaloNeural',     pitch: 'default',  etiqueta: 'Gonzalo-CO'       },
    { voz: 'es-CL-LorenzoNeural',     pitch: 'default',  etiqueta: 'Lorenzo-CL'       },
    { voz: 'es-PE-AlexNeural',        pitch: 'default',  etiqueta: 'Alex-PE'          },
    { voz: 'es-VE-SebastianNeural',   pitch: 'default',  etiqueta: 'Sebastian-VE'     },
    { voz: 'es-US-AlonsoNeural',      pitch: 'default',  etiqueta: 'Alonso-US'        },
    { voz: 'es-CU-ManuelNeural',      pitch: 'default',  etiqueta: 'Manuel-CU'        },
    { voz: 'es-EC-LuisNeural',        pitch: 'default',  etiqueta: 'Luis-EC'          },
    { voz: 'es-UY-MateoNeural',       pitch: 'default',  etiqueta: 'Mateo-UY'         },
    { voz: 'es-BO-MarceloNeural',     pitch: 'default',  etiqueta: 'Marcelo-BO'       },
];

async function sintetizar(voz, pitch, rate = 'default') {
    const lang = voz.slice(0, 5); // es-MX, es-ES, etc.
    const client = new EdgeTTS({
        voice: voz,
        lang,
        pitch,
        rate,
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        timeout: 15000
    });

    const file = join(tmpdir(), `sample-${randomUUID()}.mp3`);
    await client.ttsPromise(TEXTO, file);
    const data = await readFile(file);
    await rm(file, { force: true });
    return data;
}

console.log(`Generando ${VOCES.length} muestras en ${OUT}\n`);

const ok = [];
const err = [];

for (const { voz, pitch, etiqueta } of VOCES) {
    process.stdout.write(`  ⏳ ${etiqueta.padEnd(22)} `);
    try {
        const data = await sintetizar(voz, pitch);
        const dest = join(OUT, `${etiqueta}.mp3`);
        await writeFile(dest, data);
        process.stdout.write(`✅  (${(data.length / 1024).toFixed(0)} KB)\n`);
        ok.push(etiqueta);
    } catch (e) {
        process.stdout.write(`❌  ${e.message}\n`);
        err.push(etiqueta);
    }
}

console.log(`\n✅ ${ok.length} generadas  ❌ ${err.length} fallidas`);
console.log(`\nAbre la carpeta y escúchalas:`);
console.log(`  ${OUT}`);
