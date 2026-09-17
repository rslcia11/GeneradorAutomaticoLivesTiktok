import { Texture } from '../vendor/pixi-8.20.1.min.mjs';

/*
 * Texturas de efectos generadas por código (sin archivos extra).
 * Son blancas: el color se aplica con sprite.tint.
 */

export function createCanvasTexture(width, height, draw) {

    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    draw(canvas.getContext('2d'));

    return Texture.from(canvas);
}

function createCanvas(size, draw) {
    return createCanvasTexture(size, size, ctx => draw(ctx, size));
}

/* Resplandor redondo y suave. */
export function createGlowTexture(size = 256) {

    return createCanvas(size, (ctx, s) => {
        const gradient = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);

        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        gradient.addColorStop(0.6, 'rgba(255,255,255,0.15)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, s, s);
    });
}

/* Destello de cuatro puntas. */
export function createSparkTexture(size = 64) {

    return createCanvas(size, (ctx, s) => {
        const c = s / 2;

        const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.45);

        core.addColorStop(0, 'rgba(255,255,255,1)');
        core.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.fillStyle = core;
        ctx.fillRect(0, 0, s, s);

        ctx.globalCompositeOperation = 'lighter';

        for (const [w, h] of [[s, s * 0.06], [s * 0.06, s]]) {
            const ray = ctx.createRadialGradient(c, c, 0, c, c, c);

            ray.addColorStop(0, 'rgba(255,255,255,0.9)');
            ray.addColorStop(1, 'rgba(255,255,255,0)');

            ctx.fillStyle = ray;
            ctx.fillRect(c - w / 2, c - h / 2, w, h);
        }
    });
}

/* Anillo luminoso para ondas de energía. */
export function createRingTexture(size = 256) {

    return createCanvas(size, (ctx, s) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = s * 0.02;
        ctx.shadowColor = 'rgba(255,255,255,1)';
        ctx.shadowBlur = s * 0.05;

        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
        ctx.stroke();
    });
}

/* Brazos en espiral para el interior de la bola. */
export function createSwirlTexture(size = 256) {

    return createCanvas(size, (ctx, s) => {
        const c = s / 2;
        const arms = 3;

        for (let arm = 0; arm < arms; arm++) {
            const offset = (arm / arms) * Math.PI * 2;

            for (let i = 0; i < 70; i++) {
                const progress = i / 70;
                const angle = offset + progress * Math.PI * 1.6;
                const radius = progress * c * 0.9;

                const x = c + Math.cos(angle) * radius;
                const y = c + Math.sin(angle) * radius;

                const dot = s * 0.022 * (1 - progress * 0.6);

                ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - progress)})`;
                ctx.beginPath();
                ctx.arc(x, y, dot, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });
}
