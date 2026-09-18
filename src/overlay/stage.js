/**
 * Escenario fijo 9:16.
 *
 * Todo el overlay se diseña sobre un lienzo de 540 × 960 (la mitad de
 * 1080 × 1920, el formato de TikTok LIVE) y se escala ENTERO para caber
 * en la ventana. Así la composición es idéntica en OBS, en un monitor
 * horizontal y en el celular de quien mira: nada se encima ni se agranda
 * según la pantalla.
 */

export const STAGE = Object.freeze({ width: 540, height: 960 });

/* Mayor escala a la que el escenario entra completo en la ventana. */
export function stageScale(width, height) {

    const scale = Math.min(width / STAGE.width, height / STAGE.height);

    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/*
 * Nitidez del canvas del mago: el canvas mide 540 px de CSS, pero en OBS
 * se ve al doble. Sin multiplicar por la escala se vería borroso.
 */
export function renderResolution(scale, devicePixelRatio = 1) {
    /* Tope 2: más allá se gasta memoria de video sin verse mejor. */
    return Math.min(2, Math.max(1, (devicePixelRatio || 1) * scale));
}

let current = 1;

export function currentStageScale() {
    return current;
}

/**
 * Aplica la escala (variable CSS --stage-scale) y la mantiene al cambiar
 * el tamaño de la ventana. Avisa con el evento "stagescale".
 */
export function fitStage({ root = document.documentElement, win = window } = {}) {

    const apply = () => {
        const next = stageScale(win.innerWidth, win.innerHeight);

        /* Sin cambio no se avisa: cada aviso rehace el lienzo del mago. */
        if (next === current) {
            return;
        }

        current = next;

        root.style.setProperty('--stage-scale', String(current));
        win.dispatchEvent(new CustomEvent('stagescale', { detail: { scale: current } }));
    };

    win.addEventListener('resize', apply);
    apply();

    return current;
}
