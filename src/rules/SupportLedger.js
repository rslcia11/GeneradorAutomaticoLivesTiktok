/**
 * SupportLedger
 *
 * Lleva, por espectador:
 * - su SALDO de monedas regaladas (los regalos se suman),
 * - cuándo usó su respuesta gratis.
 *
 * El saldo se GASTA: quien regala desbloquea una lectura para su
 * siguiente pregunta, no lecturas ilimitadas. Lo que sobra queda para
 * la próxima. El saldo sin usar caduca a las 24 h.
 *
 * Quien no regala recibe una respuesta corta cada 24 h; sus preguntas
 * siguientes ni siquiera llegan a la IA.
 *
 * Solo guarda lo mínimo (id del usuario, saldo y fechas) y borra
 * automáticamente lo que caduca: no acumula datos del público.
 *
 * `now` es inyectable para poder probarlo sin esperar 24 horas.
 */

const HOUR_MS = 60 * 60 * 1000;

export class SupportLedger {

    constructor({
        windowHours = 24,
        now = () => Date.now(),
        maxUsers = 5000,

        /*
         * La limpieza recorre a todos los usuarios, así que no se hace
         * en cada regalo: balanceOf/canUseFree ya ignoran lo caducado,
         * la limpieza solo libera memoria.
         */
        pruneEveryMs = 60_000
    } = {}) {

        if (!Number.isFinite(windowHours) || windowHours <= 0) {
            throw new Error('windowHours debe ser mayor que 0');
        }

        this.windowHours = windowHours;
        this.windowMs = windowHours * HOUR_MS;
        this.now = now;
        this.maxUsers = maxUsers;
        this.pruneEveryMs = pruneEveryMs;
        this.lastPruneAt = 0;

        /* userId → { balance: number, balanceAt: number, freeAt: number|null } */
        this.users = new Map();
    }

    /**
     * Suma un regalo al saldo del usuario. Devuelve el saldo resultante.
     */
    recordGift(userId, coins) {

        const key = normalizeId(userId);

        if (!key || !Number.isFinite(coins) || coins <= 0) {
            return this.balanceOf(userId);
        }

        const entry = this.#entry(key);

        entry.balance = this.balanceOf(key) + coins;
        entry.balanceAt = this.now();
        entry.lastAt = this.now();

        this.#prune();

        return entry.balance;
    }

    /** Saldo disponible (0 si caducó). */
    balanceOf(userId) {

        const entry = this.users.get(normalizeId(userId));

        if (!entry?.balance || entry.balanceAt <= this.now() - this.windowMs) {
            return 0;
        }

        return entry.balance;
    }

    /**
     * Descuenta del saldo lo que costó el servicio entregado.
     * Devuelve el saldo restante.
     */
    spend(userId, coins) {

        const key = normalizeId(userId);
        const available = this.balanceOf(key);

        if (!Number.isFinite(coins) || coins <= 0 || available === 0) {
            return available;
        }

        const entry = this.users.get(key);

        entry.balance = Math.max(0, available - coins);
        entry.lastAt = this.now();

        this.#prune();

        return entry.balance;
    }

    /**
     * ¿Puede usar una respuesta gratis? (no la consume)
     * `everyHours` viene del catálogo; null/0 = sin límite.
     */
    canUseFree(userId, everyHours = 24) {

        if (!Number.isFinite(everyHours) || everyHours <= 0) {
            return true;
        }

        const entry = this.users.get(normalizeId(userId));

        if (!entry?.freeAt) {
            return true;
        }

        return this.now() - entry.freeAt >= everyHours * HOUR_MS;
    }

    /** Marca la respuesta gratis como usada. */
    useFree(userId) {

        const key = normalizeId(userId);

        if (!key) {
            return;
        }

        const entry = this.#entry(key);

        entry.freeAt = this.now();
        entry.lastAt = this.now();

        this.#prune();
    }

    /** Devuelve la respuesta gratis (la interacción no se entregó). */
    clearFree(userId) {

        const entry = this.users.get(normalizeId(userId));

        if (entry) {
            entry.freeAt = null;
        }
    }

    /** Cuántas horas faltan para su próxima respuesta gratis (0 si ya puede). */
    hoursUntilFree(userId, everyHours = 24) {

        if (this.canUseFree(userId, everyHours)) {
            return 0;
        }

        const entry = this.users.get(normalizeId(userId));
        const remaining = everyHours * HOUR_MS - (this.now() - entry.freeAt);

        return Math.max(0, remaining / HOUR_MS);
    }

    get size() {
        return this.users.size;
    }

    /* Para guardar en disco entre reinicios. */
    toJSON() {

        /* Antes de guardar sí conviene limpiar siempre. */
        this.lastPruneAt = 0;
        this.#prune();

        return {
            version: 1,
            users: [...this.users].map(([id, entry]) => ({ id, ...entry }))
        };
    }

    static fromJSON(data, options = {}) {

        const ledger = new SupportLedger(options);

        for (const user of data?.users ?? []) {

            const key = normalizeId(user?.id);

            if (!key) {
                continue;
            }

            ledger.users.set(key, {
                balance: Number.isFinite(user.balance) ? user.balance : 0,
                balanceAt: Number.isFinite(user.balanceAt) ? user.balanceAt : 0,
                freeAt: Number.isFinite(user.freeAt) ? user.freeAt : null,
                lastAt: Number.isFinite(user.lastAt) ? user.lastAt : 0
            });
        }

        ledger.#prune();

        return ledger;
    }

    #entry(key) {

        let entry = this.users.get(key);

        if (!entry) {
            entry = { balance: 0, balanceAt: 0, freeAt: null, lastAt: this.now() };
            this.users.set(key, entry);
        }

        return entry;
    }

    /*
     * Limpieza espaciada: solo libera memoria, nunca afecta a lo que
     * ve el espectador (los saldos caducados ya cuentan como 0).
     * Con el registro lleno se limpia igual, para no crecer sin límite.
     */
    #prune() {

        if (
            this.now() - this.lastPruneAt < this.pruneEveryMs &&
            this.users.size <= this.maxUsers
        ) {
            return;
        }

        this.lastPruneAt = this.now();

        const limit = this.now() - this.windowMs;

        for (const [key, entry] of this.users) {

            if (entry.balanceAt <= limit) {
                entry.balance = 0;
            }

            const freeExpired = !entry.freeAt || entry.freeAt <= limit;

            if (entry.balance === 0 && freeExpired) {
                this.users.delete(key);
            } else if (freeExpired) {
                entry.freeAt = null;
            }
        }

        /*
         * Protección de memoria: si aun así sobran, se van los que
         * llevan más tiempo sin actividad, no los que entraron primero
         * (un donante fiel no debe perder su saldo por gente nueva).
         */
        if (this.users.size > this.maxUsers) {

            const byOldest = [...this.users].sort(
                (a, b) => (a[1].lastAt ?? 0) - (b[1].lastAt ?? 0)
            );

            for (const [key] of byOldest.slice(0, this.users.size - this.maxUsers)) {
                this.users.delete(key);
            }
        }
    }
}

function normalizeId(userId) {
    return typeof userId === 'string' && userId.trim()
        ? userId.trim()
        : (Number.isFinite(userId) ? String(userId) : null);
}
