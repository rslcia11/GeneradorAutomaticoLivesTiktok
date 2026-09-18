import { Container, Sprite } from '../vendor/pixi-8.20.1.min.mjs';

/*
 * Efectos con pools de sprites reutilizables:
 * no se crean ni destruyen objetos durante el LIVE.
 */

/* Sprite de luz: se suma a lo que hay detrás en vez de taparlo. */
export function createAdditiveSprite(texture, { anchorY = 0.5, visible = false } = {}) {

    const sprite = new Sprite(texture);

    sprite.anchor.set(0.5, anchorY);
    sprite.blendMode = 'add';
    sprite.visible = visible;

    return sprite;
}

/* Chispas que nacen, se desplazan y se desvanecen. */
export class SparkPool {

    constructor({ texture, size = 160 }) {

        this.container = new Container();
        this.sparks = [];
        this.cursor = 0;

        for (let i = 0; i < size; i++) {
            const sprite = createAdditiveSprite(texture);

            this.container.addChild(sprite);
            this.sparks.push({ sprite, life: 0 });
        }
    }

    emit({ x, y, vx = 0, vy = 0, life = 1, scale = 0.3, tint = 0xffffff, drag = 0, spin = 0 }) {

        /* Si el pool está lleno se recicla la chispa más antigua. */
        const spark = this.sparks[this.cursor];

        this.cursor = (this.cursor + 1) % this.sparks.length;

        Object.assign(spark, { life, maxLife: life, vx, vy, scale, drag, spin });

        spark.sprite.position.set(x, y);
        spark.sprite.tint = tint;
        spark.sprite.visible = true;
    }

    update(dt) {

        for (const spark of this.sparks) {

            if (spark.life <= 0) {
                continue;
            }

            spark.life -= dt;

            const { sprite } = spark;

            if (spark.life <= 0) {
                sprite.visible = false;
                continue;
            }

            const damping = Math.max(0, 1 - spark.drag * dt);

            spark.vx *= damping;
            spark.vy *= damping;

            sprite.x += spark.vx * dt;
            sprite.y += spark.vy * dt;
            sprite.rotation += spark.spin * dt;

            const progress = 1 - spark.life / spark.maxLife;
            const fade = Math.sin(Math.PI * progress);

            sprite.alpha = fade;
            sprite.scale.set(spark.scale * (0.55 + 0.45 * fade));
        }
    }
}

/* Ondas que se expanden desde la bola. */
export class RingPool {

    constructor({ texture, size = 8 }) {

        this.container = new Container();
        this.rings = [];
        this.cursor = 0;

        for (let i = 0; i < size; i++) {
            const sprite = createAdditiveSprite(texture);

            this.container.addChild(sprite);
            this.rings.push({ sprite, life: 0 });
        }
    }

    emit({ x, y, from = 0.8, to = 2.4, life = 1.2, alpha = 0.6, tint = 0xffffff }) {

        const ring = this.rings[this.cursor];

        this.cursor = (this.cursor + 1) % this.rings.length;

        Object.assign(ring, { life, maxLife: life, from, to, alpha });

        ring.sprite.position.set(x, y);
        ring.sprite.tint = tint;
        ring.sprite.visible = true;
    }

    update(dt) {

        for (const ring of this.rings) {

            if (ring.life <= 0) {
                continue;
            }

            ring.life -= dt;

            if (ring.life <= 0) {
                ring.sprite.visible = false;
                continue;
            }

            const progress = 1 - ring.life / ring.maxLife;
            const eased = 1 - (1 - progress) ** 3;

            ring.sprite.scale.set(ring.from + (ring.to - ring.from) * eased);
            ring.sprite.alpha = ring.alpha * (1 - progress);
        }
    }
}

/* Destellos sobre las cartas del tarot. */
export class CardGlints {

    constructor({ texture, positions, tint = 0xffe2a0 }) {

        this.container = new Container();

        this.glints = positions.map(({ x, y }) => {
            const sprite = createAdditiveSprite(texture);

            sprite.position.set(x, y);
            sprite.tint = tint;

            this.container.addChild(sprite);

            return { sprite, delay: 0, life: 0 };
        });
    }

    get count() {
        return this.glints.length;
    }

    trigger(index, delay = 0, life = 0.7) {

        const glint = this.glints[index];

        Object.assign(glint, { delay, life, maxLife: life });
    }

    sweep({ stagger = 0.1, life = 0.7 } = {}) {

        this.glints.forEach((_, index) => {
            this.trigger(index, index * stagger, life);
        });
    }

    update(dt) {

        for (const glint of this.glints) {

            const { sprite } = glint;

            if (glint.delay > 0) {
                glint.delay -= dt;
                continue;
            }

            if (glint.life <= 0) {
                sprite.visible = false;
                continue;
            }

            glint.life -= dt;

            const progress = 1 - Math.max(0, glint.life) / glint.maxLife;
            const pulse = Math.sin(Math.PI * progress);

            sprite.visible = true;
            sprite.alpha = pulse;
            sprite.scale.set(0.9 * pulse);
            sprite.rotation = progress * Math.PI * 0.5;
        }
    }
}
