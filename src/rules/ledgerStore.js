import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { SupportLedger } from './SupportLedger.js';

/**
 * Guarda y recupera la memoria de apoyo de 24 h (SupportLedger) en un
 * archivo JSON local, para que un reinicio no borre a quienes ya apoyaron.
 *
 * Se escribe primero en un archivo temporal y luego se renombra: si el
 * proceso muere a mitad de la escritura, el archivo anterior queda intacto.
 */
export async function loadLedger(path, options = {}) {

    try {
        const data = JSON.parse(await readFile(path, 'utf8'));

        return SupportLedger.fromJSON(data, options);

    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(
                `⚠️ No se pudo leer la memoria de apoyo (${error.message}); se empieza vacía`
            );
        }

        return new SupportLedger(options);
    }
}

export async function saveLedger(path, ledger) {

    const temporary = `${path}.tmp`;

    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify(ledger.toJSON()), 'utf8');
    await rename(temporary, path);
}

/**
 * Guardado diferido: muchos regalos seguidos escriben una sola vez.
 * `flush()` fuerza el guardado pendiente (al cerrar la app).
 */
export function createLedgerSaver({ path, ledger, delayMs = 5000, onError = console.warn }) {

    let timer = null;
    let pending = false;
    let writing = null;

    const write = async () => {
        pending = false;

        /* flush() debe poder esperar a que el archivo quede escrito. */
        writing = saveLedger(path, ledger).catch(error => {
            onError(`⚠️ No se pudo guardar la memoria de apoyo: ${error.message}`);
        });

        await writing;

        writing = null;
    };

    return {
        schedule() {
            pending = true;

            if (timer) {
                return;
            }

            timer = setTimeout(() => {
                timer = null;
                void write();
            }, delayMs);

            timer.unref?.();
        },

        async flush() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            /* Un guardado a medias no debe perderse al cerrar. */
            await writing;

            if (pending) {
                await write();
            }
        }
    };
}
