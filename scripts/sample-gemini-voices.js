/**
 * Genera muestras de voz con Gemini TTS para elegir la del mago.
 *
 *   node --env-file=.env scripts/sample-gemini-voices.js
 *
 * Los archivos WAV quedan en samples/voices-gemini/.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'samples', 'voices-gemini');

const API_KEY = process.env.GEMINI_API_KEY?.trim();
if (!API_KEY) {
    console.error('❌ Pon GEMINI_API_KEY en .env y ejecuta con --env-file=.env');
    process.exit(1);
}

await mkdir(OUT, { recursive: true });

/* Frase para la muestra */
const TEXTO =
    'Las estrellas revelan tu camino... ' +
    'Hay fuerzas ocultas que trabajan a tu favor, aunque aún no las puedas ver. ' +
    'Ten paciencia, pues el universo conspira por ti.';

/* Prompt con personalidad de viejo sabio — Gemini ajusta el ritmo y carácter */
const SYSTEM_VIEJO =
    'Eres un anciano mago sabio de voz profunda y pausada. ' +
    'Hablas lento, con misterio y solemnidad. No hay prisa en tus palabras.';

/* Voces masculinas más graves de Gemini */
const MUESTRAS = [
    /* Charon — el que más pinta tiene */
    { voz: 'Charon',          system: null,         etiqueta: '01-Charon-neutral'    },
    { voz: 'Charon',          system: SYSTEM_VIEJO, etiqueta: '02-Charon-mago'       },

    /* Fenrir — profundo, nórdico */
    { voz: 'Fenrir',          system: null,         etiqueta: '03-Fenrir-neutral'    },
    { voz: 'Fenrir',          system: SYSTEM_VIEJO, etiqueta: '04-Fenrir-mago'       },

    /* Orus — nombre egipcio, podría ser serio */
    { voz: 'Orus',            system: null,         etiqueta: '05-Orus-neutral'      },
    { voz: 'Orus',            system: SYSTEM_VIEJO, etiqueta: '06-Orus-mago'         },

    /* Rasalas — estrella en Leo, desconocido */
    { voz: 'Rasalas',         system: SYSTEM_VIEJO, etiqueta: '07-Rasalas-mago'      },

    /* Umbriel — luna oscura de Urano */
    { voz: 'Umbriel',         system: SYSTEM_VIEJO, etiqueta: '08-Umbriel-mago'      },

    /* Algenib — por si acaso */
    { voz: 'Algenib',         system: SYSTEM_VIEJO, etiqueta: '09-Algenib-mago'      },
];

/* Convierte PCM L16 mono 24 kHz → WAV */
function pcmToWav(pcm) {
    const buf = Buffer.alloc(44 + pcm.length);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + pcm.length, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);   // PCM
    buf.writeUInt16LE(1, 22);   // mono
    buf.writeUInt32LE(24000, 24);
    buf.writeUInt32LE(48000, 28); // byteRate = 24000 * 1 * 2
    buf.writeUInt16LE(2, 32);   // blockAlign
    buf.writeUInt16LE(16, 34);  // bitsPerSample
    buf.write('data', 36);
    buf.writeUInt32LE(pcm.length, 40);
    pcm.copy(buf, 44);
    return buf;
}

async function sintetizar(voz, system) {
    const contents = [];

    if (system) {
        contents.push({ role: 'user',  parts: [{ text: system }] });
        contents.push({ role: 'model', parts: [{ text: 'Entendido.' }] });
    }

    contents.push({ role: 'user', parts: [{ text: TEXTO }] });

    const body = {
        contents,
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: voz }
                }
            }
        }
    };

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': API_KEY
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000)
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${err?.error?.message ?? 'sin detalle'}`);
    }

    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.[0];

    if (!part?.inlineData?.data) {
        throw new Error(`Respuesta inesperada: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const pcm = Buffer.from(part.inlineData.data, 'base64');
    return pcmToWav(pcm);
}

console.log(`Generando ${MUESTRAS.length} muestras en:\n  ${OUT}\n`);

const ok = [];
const err = [];

for (const { voz, system, etiqueta } of MUESTRAS) {
    process.stdout.write(`  ⏳ ${etiqueta.padEnd(26)} `);
    try {
        const wav = await sintetizar(voz, system);
        const dest = join(OUT, `${etiqueta}.wav`);
        await writeFile(dest, wav);
        process.stdout.write(`✅  (${(wav.length / 1024).toFixed(0)} KB)\n`);
        ok.push(etiqueta);
    } catch (e) {
        process.stdout.write(`❌  ${e.message}\n`);
        err.push(etiqueta);
    }
}

console.log(`\n✅ ${ok.length} generadas  ❌ ${err.length} fallidas`);
console.log(`\nAbre la carpeta y escúchalas:`);
console.log(`  ${OUT}`);
