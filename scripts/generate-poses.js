/**
 * Genera las poses del mago usando InstructPix2Pix (gratis, sin token).
 *
 *   node --env-file=.env scripts/generate-poses.js
 *
 * Usa el Space público de HuggingFace: timbrooks/instruct-pix2pix
 * No requiere créditos ni cuenta de pago.
 * Las imágenes se guardan en src/overlay/assets/poses/.
 */

import { Client } from '@gradio/client';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSES_DIR = join(ROOT, 'src/overlay/assets/poses');
const REF_IMAGE = join(ROOT, 'src/overlay/assets/tarot-character.png');

const POSES = [
    {
        name:        'comment-2',
        instruction: 'Make the wizard raise his right hand with index finger pointing upward, as if making an important point. Keep everything else identical.'
    },
    {
        name:        'comment-3',
        instruction: 'Make the wizard lean slightly forward with both hands clasped together in front of his chest, as if sharing a secret. Keep everything else identical.'
    },
    {
        name:        'listening',
        instruction: 'Make the wizard stand with arms slightly spread open and palms facing outward in a welcoming stance, head slightly tilted as if listening. Keep everything else identical.'
    },
    {
        name:        'react',
        instruction: 'Make the wizard raise both arms high in joyful celebration with a wide smile. Keep everything else identical.'
    }
];

async function main() {
    const imageBuffer = await readFile(REF_IMAGE);
    const imageBlob   = new Blob([imageBuffer], { type: 'image/png' });

    await mkdir(POSES_DIR, { recursive: true });

    const hfToken = process.env.HF_TOKEN?.trim();

    console.log('\nConectando con instruct-pix2pix...');
    const app = await Client.connect('timbrooks/instruct-pix2pix', {
        hf_token: hfToken || undefined
    });
    console.log('Conectado.\n');

    console.log(`Generando ${POSES.length} poses...\n`);

    let ok = 0, failed = 0;

    for (const { name, instruction } of POSES) {
        process.stdout.write(`  ⏳ ${name.padEnd(14)} `);

        try {
            const result = await app.predict('/generate', [
                imageBlob,          // input_image
                instruction,        // instruction
                50,                 // steps
                'Randomize Seed',   // randomize_seed
                0,                  // seed
                'Fix CFG',          // randomize_cfg
                7.5,                // text_cfg_scale
                1.5                 // image_cfg_scale
            ]);

            /* El Space devuelve [número, número, número, {url}] — buscar el primer Blob o {url} o {path} */
            const outputBlob = result.data?.find(d =>
                d instanceof Blob ||
                (typeof d === 'object' && (d?.url || d?.path))
            );
            if (!outputBlob) throw new Error(`Sin imagen en respuesta: ${JSON.stringify(result.data?.map(d => typeof d))}`);

            let buffer;
            if (outputBlob instanceof Blob) {
                buffer = Buffer.from(await outputBlob.arrayBuffer());
            } else {
                const imgUrl = outputBlob.url || outputBlob.path;
                const res    = await fetch(imgUrl.startsWith('http') ? imgUrl : `https://timbrooks-instruct-pix2pix.hf.space/file=${imgUrl}`);
                buffer       = Buffer.from(await res.arrayBuffer());
            }

            const dest = join(POSES_DIR, `${name}.webp`);
            await writeFile(dest, buffer);

            process.stdout.write(`✅  (${(buffer.length / 1024).toFixed(0)} KB)\n`);
            ok++;

        } catch (e) {
            process.stdout.write(`❌  ${e.message}\n`);
            failed++;
        }
    }

    console.log(`\n✅ ${ok} generadas  ❌ ${failed} fallidas`);

    if (ok > 0) {
        console.log(`\nPoses en: ${POSES_DIR}`);
        console.log('Recargá el overlay: Ctrl+R en el navegador.');
    }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
