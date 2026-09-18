/**
 * Reintenta `attempt()` con espera creciente (base, ×2, ×4...) hasta `maxDelayMs`.
 *
 * `maxAttempts <= 0` = para siempre: en el servidor el cliente no siempre
 * está en vivo y la instancia debe esperarlo sin morir. El tope de espera
 * (2 min) limita las firmas de Euler Stream a ~720 por día.
 *
 * Resuelve con lo que devuelva `attempt`, rechaza con el último error si se
 * agotan los intentos, o resuelve `undefined` si `stopped()` se vuelve true.
 */
export async function retryWithBackoff(attempt, {
    maxAttempts = 5,
    baseDelayMs = 5000,
    maxDelayMs = 120_000,
    stopped = () => false,
    onRetry = () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {

    const forever = maxAttempts <= 0;

    for (let n = 1; forever || n <= maxAttempts; n++) {

        if (stopped()) {
            return undefined;
        }

        try {
            return await attempt(n);
        } catch (error) {
            if (!forever && n === maxAttempts) {
                throw error;
            }

            const delayMs = Math.min(baseDelayMs * 2 ** (n - 1), maxDelayMs);

            onRetry({ attempt: n, error, delayMs });
            await sleep(delayMs);
        }
    }
}
