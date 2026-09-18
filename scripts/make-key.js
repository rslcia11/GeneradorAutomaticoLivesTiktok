/**
 * Genera una clave de overlay nueva (OVERLAY_KEY).
 *
 *   node scripts/make-key.js
 *
 * Pégala en el .env de la instancia. Una clave por cliente; si se filtra,
 * se genera otra y se cambia la URL de OBS.
 */

import { generateAccessKey } from '../src/realtime/accessKey.js';

console.log(generateAccessKey());
