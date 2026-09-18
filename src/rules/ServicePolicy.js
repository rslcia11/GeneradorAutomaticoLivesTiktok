import { RESPONSE_STYLES, createCatalog, menuServices, resolveService } from './serviceCatalog.js';
import { SupportLedger } from './SupportLedger.js';

/**
 * ServicePolicy
 *
 * Decide QUÉ recibe cada espectador:
 *
 *   sin saldo  → una respuesta corta (sí/no) cada 24 h
 *   con saldo  → el mejor servicio que alcance, y SE CONSUME
 *                (regalar una vez = una lectura, no lecturas ilimitadas)
 *
 * Las preguntas gratis repetidas se rechazan aquí: nunca llegan a la IA.
 */
export class ServicePolicy {

    constructor({
        catalog = createCatalog(),
        ledger = new SupportLedger(),

        /* Se llama cada vez que cambia el saldo o la gratis (para guardar). */
        onChange = null
    } = {}) {

        this.catalog = catalog;
        this.ledger = ledger;
        this.onChange = onChange;

        this.free = catalog.find(service => service.coins === 0);

        if (this.free.freeEveryHours > this.ledger.windowHours) {
            throw new Error(
                `La respuesta gratis (${this.free.freeEveryHours} h) no puede durar ` +
                `más que la memoria del registro (${this.ledger.windowHours} h)`
            );
        }

        /*
         * Agradecer un regalo siempre es breve: no gasta el estilo largo
         * del servicio comprado, que se usará en su pregunta.
         */
        this.giftThanks = Object.freeze({
            ...this.free,
            id: 'gift_thanks',
            label: 'Agradecimiento',
            style: RESPONSE_STYLES.SHORT
        });

        this.stats = {
            freeGranted: 0,
            freeRejected: 0,
            paidGranted: 0,
            refunded: 0
        };
    }

    /** Monedas de un evento de regalo (un regalo repetido cuenta por su total). */
    static giftCoins(event) {

        const coins = Number(event?.gift?.diamondCount) || 0;
        const repeat = Number(event?.gift?.repeatCount) || 1;

        return coins * repeat;
    }

    /*
     * Un combo (varias rosas seguidas) emite un evento por cada envío y
     * el último trae el total. Solo cuenta el último: si no, una racha
     * de 10 rosas sumaría 55 monedas en vez de 10.
     */
    static isGiftFinal(event) {
        return event?.gift?.combo !== true || Number(event?.gift?.repeatEnd) === 1;
    }

    /**
     * Registra un regalo y devuelve el servicio que desbloquea.
     */
    registerGift(event) {

        if (!ServicePolicy.isGiftFinal(event)) {
            return { coins: 0, counted: false };
        }

        const coins = ServicePolicy.giftCoins(event);
        const balance = this.ledger.recordGift(userIdOf(event), coins);

        this.#changed();

        return {
            coins,
            counted: coins > 0,
            balance,

            /* Lo que desbloquea con su saldo actual (aún sin consumir). */
            service: this.#serviceFor(balance)
        };
    }

    /**
     * ¿Se responde este comentario y con qué servicio?
     * Consume la respuesta gratis cuando corresponde.
     */
    evaluateComment(event) {

        const userId = userIdOf(event);
        const balance = this.ledger.balanceOf(userId);
        const service = this.#serviceFor(balance);

        if (service.level > this.free.level) {
            /*
             * La lectura se cobra ya (si no, una ráfaga de preguntas
             * cobraría una vez y pediría varias). Si la respuesta no
             * llega, refund() lo devuelve.
             */
            const remaining = this.ledger.spend(userId, service.coins);

            this.#changed();
            this.stats.paidGranted++;

            return {
                allowed: true,
                service,
                balance,
                remaining,
                priority: service.priority
            };
        }

        if (!this.ledger.canUseFree(userId, this.free.freeEveryHours)) {
            this.stats.freeRejected++;

            return {
                allowed: false,
                reason: 'free_quota_used',
                service: this.free,
                balance,
                hoursUntilFree: this.ledger.hoursUntilFree(userId, this.free.freeEveryHours)
            };
        }

        this.ledger.useFree(userId);

        this.#changed();
        this.stats.freeGranted++;

        return {
            allowed: true,
            service: this.free,
            balance,
            remaining: balance,
            priority: this.free.priority
        };
    }

    /**
     * Servicio con el que se agradece un regalo (ya registrado).
     */
    evaluateGift(event) {

        const balance = this.ledger.balanceOf(userIdOf(event));
        const unlocked = this.#serviceFor(balance);

        return {
            allowed: true,

            /* Se agradece breve; la lectura se entrega en su pregunta. */
            service: this.giftThanks,
            unlocked,

            balance,
            priority: unlocked.priority
        };
    }

    /**
     * Devuelve lo cobrado cuando la interacción no se entregó
     * (cola llena, fallo de la IA...). Nadie paga por nada.
     */
    refund(decision) {

        const service = decision?.service;
        const userId = userIdOf(decision?.event);

        if (!service || !userId) {
            return false;
        }

        if (service.level > this.free.level) {
            this.ledger.recordGift(userId, service.coins);
            this.stats.refunded++;
        } else {
            this.ledger.clearFree(userId);
            this.stats.refunded++;
        }

        this.#changed();

        return true;
    }

    #changed() {
        this.onChange?.();
    }

    /* Servicio que corresponde a un saldo. */
    #serviceFor(balance) {
        return resolveService(this.catalog, balance);
    }

    /** Qué servicio desbloquea un regalo de `coins` monedas (sin saldo previo). */
    unlocks(coins) {
        return this.#serviceFor(coins);
    }

    /** Menú de regalos para el overlay. */
    menu() {
        return menuServices(this.catalog);
    }

    getStats() {
        return {
            ...this.stats,
            trackedUsers: this.ledger.size
        };
    }
}

function userIdOf(event) {
    return event?.user?.id ?? event?.user?.username ?? null;
}
