/**
 * HUD del LIVE: menú de servicios, últimos en apoyar y franja de contacto.
 *
 * No decide nada: pinta lo que manda el backend
 *   service_menu   → catálogo de servicios (src/rules/serviceCatalog.js)
 *   donor_board    → últimos regalos recibidos
 *   contact_banner → frase y teléfono configurables (.env)
 *
 * Los textos vienen del backend para que cada streamer configure el suyo
 * sin tocar el overlay.
 */

import { formatNumber } from './format.js';

/* Ícono por servicio, según lo que ofrece. */
const SERVICE_ICONS = Object.freeze({
    reading_long: '🔮',
    reading: '🃏',
    full: '💬',
    short: '✨',
    yes_no: '🌙'
});

const MAX_DONORS = 5;

/* La franja de contacto aparece por primera vez a los 15 s de abrir. */
const FIRST_CONTACT_MS = 15_000;

/* Lo que dura el fundido de salida (igual que en styles.css). */
const FADE_MS = 600;

/* El menú de servicios se muestra a ratos, nunca fijo. */
const MENU_VISIBLE_MS = 25_000;
const MENU_HIDDEN_MS = 50_000;

function iconOf(service) {

    const icon = document.createElement('span');

    icon.className = 'service-menu__icon';
    icon.textContent = service.icon ?? SERVICE_ICONS[service.style] ?? '🎁';

    return icon;
}

/*
 * Imagen original del regalo (CDN de TikTok). Sin "referrer": algunos CDN
 * rechazan imágenes pedidas desde otra página. Si no carga (o la URL no es
 * https), se reemplaza por `fallback()` o, sin él, se oculta.
 */
function giftImage(src, alt, className, fallback = null) {

    const safe = typeof src === 'string' && src.startsWith('https://');

    if (!safe && fallback) {
        return fallback();
    }

    const image = document.createElement('img');

    image.className = className;
    image.alt = alt;
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';

    if (safe) {
        image.src = src;
    } else {
        image.hidden = true;
    }

    image.onerror = () => {
        if (fallback) {
            image.replaceWith(fallback());
        } else {
            image.hidden = true;
        }
    };

    return image;
}

export class Hud {

    /*
     * Los temporizadores se envuelven a propósito: `setTimeout` guardado
     * como propiedad y llamado como método (this.setTimer(...)) falla en el
     * navegador con "Illegal invocation", porque necesita a `window` como
     * dueño. En Node no falla, así que un test no lo detectaría.
     */
    constructor({
        elements,
        setTimer = (callback, ms) => setTimeout(callback, ms),
        clearTimer = handle => clearTimeout(handle),
        setRepeating = (callback, ms) => setInterval(callback, ms),
        clearRepeating = handle => clearInterval(handle)
    }) {

        this.elements = elements;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.setRepeating = setRepeating;
        this.clearRepeating = clearRepeating;

        this.contactTimer = null;
        this.menuTimer = null;
        this.dayTimerInterval = null;
    }

    /** Evento del backend → panel correspondiente. Devuelve true si lo manejó. */
    handle(event) {

        switch (event?.type) {

            case 'service_menu':
                this.showServices(event.services);
                return true;

            case 'donor_board':
                this.showDonors(event.donors);
                return true;

            case 'contact_banner':
                this.startContact(event.contact);
                return true;

            case 'promo_banner':
                this.showPromo(event.promo);
                return true;

            default:
                return false;
        }
    }

    showServices(services) {

        const { serviceMenu, serviceMenuList } = this.elements;

        if (!serviceMenu || !Array.isArray(services) || services.length === 0) {
            return;
        }

        serviceMenuList.replaceChildren(
            ...services.map((service, index) => {
                const item = document.createElement('li');
                item.className = 'service-menu__item';
                item.style?.setProperty('--i', index);

                const gift = service.tiktokGift;

                const label = document.createElement('span');
                label.className = 'service-menu__label';
                label.textContent = service.label;

                const price = document.createElement('span');
                price.className = 'service-menu__price';
                price.textContent = formatNumber(gift?.coins ?? service.coins, '—');

                const media = gift?.image
                    ? giftImage(gift.image, gift.name, 'service-menu__gift', () => iconOf(service))
                    : iconOf(service);

                /* Icono + monedas apilados verticalmente */
                const mediaWrap = document.createElement('div');
                mediaWrap.className = 'service-menu__media-wrap';
                mediaWrap.append(media, price);

                item.append(mediaWrap, label);

                return item;
            })
        );

        this.#startDayTimer();
        this.#cycleMenu();
    }

    showDonors(donors) {

        const { donorBoard, donorBoardList } = this.elements;

        if (!donorBoard) {
            return;
        }

        const list = Array.isArray(donors) ? donors.slice(0, MAX_DONORS) : [];

        /* La tabla aparece solo cuando hay donantes. */
        if (list.length === 0) {
            donorBoard.hidden = true;
            donorBoardList.replaceChildren();
            return;
        }

        donorBoard.hidden = false;

        donorBoardList.replaceChildren(
            ...list.map((donor, index) => {
                const item = document.createElement('li');
                item.className = 'donor-board__item';
                item.style?.setProperty('--i', index);

                /* El más reciente se resalta un instante. */
                if (index === 0) {
                    item.classList.add('donor-board__item--new');
                }

                const rank = document.createElement('span');
                rank.className = 'donor-board__rank';
                rank.textContent = index === 0 ? '👑' : String(index + 1);

                item.append(rank);

                if (donor.image) {
                    item.append(giftImage(donor.image, donor.gift ?? 'regalo', 'donor-board__gift-image'));
                }

                const name = document.createElement('span');
                name.className = 'donor-board__name';
                name.textContent = donor.nickname || `@${donor.username ?? 'anónimo'}`;

                const gift = document.createElement('span');
                gift.className = 'donor-board__gift';
                gift.textContent = donor.gift ?? 'regalo';

                const coins = document.createElement('span');
                coins.className = 'donor-board__coins';
                coins.textContent = formatNumber(donor.coins, '—');

                item.append(name, gift, coins);

                return item;
            })
        );
    }

    /**
     * Muestra la franja de contacto unos segundos, cada cierto tiempo.
     * Nunca queda fija en pantalla.
     */
    startContact(contact) {

        this.stopContact();

        const { contactBanner } = this.elements;

        const enabled = contact?.enabled === true;
        const phone = enabled && typeof contact.phone === 'string' ? contact.phone.trim() : '';

        /*
         * El teléfono viaja DENTRO de la franja: nada queda fijo en pantalla.
         * Si la frase ya lo menciona, no se repite.
         */
        const base = enabled && typeof contact.text === 'string' ? contact.text.trim() : '';
        const text = phone && !base.includes(phone) ? `${base} ${phone}`.trim() : base;

        if (!contactBanner || !text) {
            return;
        }

        const visibleMs = Math.max(1000, (contact.visibleSeconds ?? 12) * 1000);
        const everyMs = Math.max(visibleMs + 1000, (contact.everyMinutes ?? 10) * 60_000);

        contactBanner.textContent = text;

        /* Un solo temporizador vivo a la vez: nada se acumula. */
        const later = (callback, ms) => {
            this.contactTimer = this.setTimer(callback, ms);
        };

        const show = () => {
            contactBanner.hidden = false;

            /*
             * La clase va en el siguiente turno: un elemento que acaba de
             * dejar de estar oculto no anima si se le cambia todo junto,
             * y la franja aparecería de golpe.
             */
            later(() => {
                contactBanner.classList.add('contact-banner--visible');

                later(() => {
                    contactBanner.classList.remove('contact-banner--visible');

                    later(() => {
                        contactBanner.hidden = true;

                        /* Se encadena la próxima vuelta con el mismo mecanismo. */
                        later(show, Math.max(0, everyMs - visibleMs - FADE_MS));
                    }, FADE_MS);
                }, visibleMs);
            }, 0);
        };

        /* La primera vez espera un poco: no arranca encima del saludo. */
        later(show, Math.min(everyMs, FIRST_CONTACT_MS));
    }

    stopContact() {

        if (this.contactTimer !== null) {
            this.clearTimer(this.contactTimer);
            this.contactTimer = null;
        }

        const { contactBanner } = this.elements;

        if (contactBanner) {
            contactBanner.hidden = true;
            contactBanner.classList.remove('contact-banner--visible');
        }
    }

    showPromo(promo) {

        const { promoBanner } = this.elements;

        if (!promoBanner) {
            return;
        }

        const text = typeof promo?.text === 'string' ? promo.text.trim() : '';

        if (!promo?.enabled || !text) {
            promoBanner.hidden = true;
            return;
        }

        promoBanner.textContent = text;
        promoBanner.hidden = false;
    }

    destroy() {
        this.stopContact();
        this.#stopDayTimer();

        if (this.menuTimer !== null) {
            this.clearTimer(this.menuTimer);
            this.menuTimer = null;
        }
    }

    /**
     * El menú NO vive fijo en pantalla: aparece un rato y se va.
     *
     * TikTok penaliza los paneles estáticos y, sobre todo, tener íconos de
     * regalo y precios permanentes: lo lee como pedir regalos.
     */
    #cycleMenu() {

        const { serviceMenu } = this.elements;

        if (this.menuTimer !== null) {
            this.clearTimer(this.menuTimer);
            this.menuTimer = null;
        }

        serviceMenu.hidden = false;

        /* Aplica en el siguiente turno para que la transición CSS arranque. */
        this.setTimer(() => {
            serviceMenu.classList.add('service-menu--visible');
        }, 0);
    }

    /* Cuenta atrás hasta medianoche: cuándo se renueva la pregunta gratis. */
    #startDayTimer() {

        const { serviceMenuTimer } = this.elements;

        if (!serviceMenuTimer) {
            return;
        }

        const pad = number => String(number).padStart(2, '0');

        const update = () => {
            const now = new Date();
            const midnight = new Date(now);

            midnight.setHours(24, 0, 0, 0);

            const seconds = Math.max(0, Math.floor((midnight - now) / 1000));
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);

            serviceMenuTimer.textContent = hours > 0
                ? `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`
                : `${pad(minutes)}:${pad(seconds % 60)}`;
        };

        update();

        this.#stopDayTimer();
        this.dayTimerInterval = this.setRepeating(update, 1000);
    }

    #stopDayTimer() {

        if (this.dayTimerInterval !== null) {
            this.clearRepeating(this.dayTimerInterval);
            this.dayTimerInterval = null;
        }
    }
}

