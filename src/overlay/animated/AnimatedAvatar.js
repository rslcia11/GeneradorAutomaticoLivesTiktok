import {
    Application,
    Assets,
    Container,
    Graphics,
    Mesh,
    MeshPlane,
    Sprite,
    isWebGLSupported
} from '../vendor/pixi-8.20.1.min.mjs';

import { applyRig, createRig, weightRigValue } from './warp.js';
import { ANCHORS, DEFORMERS, PINS, TEXTURE_SIZE } from './wizardRig.js';
import { CardGlints, RingPool, SparkPool } from './effects.js';
import { SpeechLevel } from './speech.js';
import { FloatingCards } from './tarotCards.js';
import { BASE_POSE, POSE_FILES, PoseBlender, selectPose } from './poses.js';

import {
    createGlowTexture,
    createRingTexture,
    createSparkTexture,
    createSwirlTexture
} from './textures.js';

/**
 * AnimatedAvatar
 *
 * Renderer WebGL (PixiJS) del mago. Se activa con ?avatar=animado.
 *
 * NO decide estados: escucha los eventos que ya emite TarotAvatar
 * ("avatarstatechange" y "avatarcelebrate") sobre el mismo root.
 * Si WebGL no está disponible, create() falla y el overlay
 * conserva el avatar CSS.
 */

const COLORS = Object.freeze({
    violet: 0xa87bff,
    cyan: 0x8fe3ff,
    gold: 0xffd98a,
    rose: 0xff9ad5
});

const BALL_SPARK_TINTS = Object.freeze([COLORS.violet, COLORS.cyan, COLORS.gold]);

const CELEBRATION_TINTS = Object.freeze({
    gift: [COLORS.gold, COLORS.rose],
    follow: [COLORS.violet, COLORS.cyan],
    share: [COLORS.cyan, COLORS.gold],
    subscription: [COLORS.gold, COLORS.violet]
});

/*
 * Intensidad visual de cada estado. Los valores actuales se
 * acercan suavemente a estos objetivos: nunca hay saltos.
 */
const STATE_PROFILES = Object.freeze({
    idle: { glow: 0.35, swirl: 0.3, sparks: 1.5, aura: 0.25, ringEvery: 0, hands: 1, headSway: 1, eyeGlow: 0, lean: 0 },
    listening: { glow: 0.55, swirl: 0.8, sparks: 4, aura: 0.4, ringEvery: 1.8, hands: 1.3, headSway: 0.8, eyeGlow: 0.15, lean: 0.014 },
    thinking: { glow: 0.95, swirl: 2.6, sparks: 12, aura: 0.6, ringEvery: 0.85, hands: 2.8, headSway: 0.5, eyeGlow: 0.9, lean: -0.012 },
    speaking: { glow: 0.65, swirl: 1.2, sparks: 5, aura: 0.5, ringEvery: 0, hands: 1.8, headSway: 1.4, eyeGlow: 0.1, lean: 0 },
    reacting: { glow: 1, swirl: 3, sparks: 16, aura: 0.7, ringEvery: 0.55, hands: 2.2, headSway: 1.2, eyeGlow: 0.3, lean: 0.01 }
});

/* Resolución de la malla: ~10 px entre vértices. */
const MESH_VERTICES = Object.freeze({ x: 100, y: 164 });

const BLINK_S = 0.16;
const EAR_TWITCH_S = 0.22;
const CELEBRATION_S = 1.6;

/* Fundido entre poses y "rebote" del cuerpo al cambiar de pose. */
const POSE_FADE_S = 0.22;
const POSE_KICK_S = 0.45;

/* Radio del anillo dibujado en createRingTexture (256 × 0.42). */
const RING_TEXTURE_RADIUS = 107;

const BASE_ONLY_DEFORMERS = DEFORMERS.filter(deformer => deformer.baseOnly);

/* Curva 0 → 1 → 0 para un contador que baja de 1 a 0. */
function riseAndFall(remaining) {
    return remaining > 0 ? Math.sin(Math.PI * (1 - remaining)) : 0;
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

export class AnimatedAvatar {

    static async create({ root, imageUrl, initialState = 'idle', initialIntent = null, maxFPS = 60, debug = null }) {

        if (!isWebGLSupported()) {
            throw new Error('WebGL no está disponible en este navegador');
        }

        const avatar = new AnimatedAvatar({ root, initialState, initialIntent, maxFPS, debug });

        try {
            await avatar.#init(imageUrl);
        } catch (error) {
            avatar.destroy();
            throw error;
        }

        return avatar;
    }

    constructor({ root, initialState, initialIntent, maxFPS, debug }) {

        this.root = root;
        this.maxFPS = maxFPS;
        this.debug = debug;

        this.state = STATE_PROFILES[initialState] ? initialState : 'idle';
        this.intent = initialIntent ?? null;

        this.values = { ...STATE_PROFILES[this.state] };

        /* Arranca en la base; la pose del estado inicial entra al cargar. */
        this.poses = new PoseBlender({ fadeS: POSE_FADE_S });
        this.poseMeshes = new Map();
        this.wantedPose = selectPose({ state: this.state, intent: this.intent });
        this.poseKick = 0;

        this.time = 0;
        this.celebration = 0;

        this.speech = new SpeechLevel();

        this.timers = {
            spark: 0,
            ring: 0,
            blink: randomBetween(1.5, 4),
            blinkPhase: -1,
            ear: randomBetween(4, 9),
            earPhase: -1,
            glint: randomBetween(2, 5)
        };

        this.rigValues = Object.fromEntries(
            DEFORMERS.map(deformer => [deformer.name, {}])
        );

        this.layoutSize = { width: 0, height: 0 };

        this.app = null;
        this.host = null;
        this.hud = null;
        this.textures = [];

        this.handleStateChange = event => {
            if (STATE_PROFILES[event.detail?.state]) {
                this.state = event.detail.state;
                this.intent = event.detail.intent ?? null;
                this.#showPose(selectPose(event.detail));
            }
        };

        this.handleCelebrate = event => {
            this.celebrate(event.detail?.kind);
        };

        this.handleVisibility = () => {
            /* ticker no existe hasta que termina app.init(). */
            if (document.hidden) {
                this.app?.ticker?.stop();
            } else {
                this.app?.ticker?.start();
            }
        };
    }

    /**
     * Volumen real de la voz (0..1) cuando exista TTS.
     * Mientras no se llame, la mandíbula usa un ritmo sintético.
     */
    setSpeechLevel(level) {
        this.speech.setExternalLevel(level);
    }

    celebrate(kind = 'gift') {

        if (!this.sparks) {
            return;
        }

        /*
         * cheer = sin(π · (1 − celebration)).
         * Si ya pasó el pico (< 0.5), 1 − c da el mismo cheer en la
         * subida: la celebración se alarga sin que las manos caigan
         * de golpe con regalos seguidos. Si aún sube, sigue igual.
         */
        if (this.celebration < 0.5) {
            this.celebration = 1 - this.celebration;
        }

        const { ball } = ANCHORS;
        const tints = CELEBRATION_TINTS[kind] ?? CELEBRATION_TINTS.gift;

        for (let i = 0; i < 46; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = randomBetween(160, 420);

            this.sparks.emit({
                x: ball.x,
                y: ball.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                life: randomBetween(0.9, 1.6),
                scale: randomBetween(0.3, 0.65),
                tint: pick(tints),
                drag: 2.2,
                spin: randomBetween(-4, 4)
            });
        }

        for (const hand of ANCHORS.hands) {
            for (let i = 0; i < 12; i++) {
                this.sparks.emit({
                    x: hand.x + randomBetween(-50, 50),
                    y: hand.y + randomBetween(-30, 30),
                    vx: randomBetween(-30, 30),
                    vy: randomBetween(-160, -70),
                    life: randomBetween(0.8, 1.4),
                    scale: randomBetween(0.2, 0.4),
                    tint: pick(tints),
                    drag: 1.2
                });
            }
        }

        this.glints.sweep({ stagger: 0.08, life: 0.8 });

        for (const delay of [0, 1]) {
            this.rings.emit({
                x: ball.x,
                y: ball.y,
                from: (ball.radius / RING_TEXTURE_RADIUS) * (0.9 + delay * 0.4),
                to: (ball.radius / RING_TEXTURE_RADIUS) * (4 + delay),
                life: 1 + delay * 0.3,
                alpha: 0.8,
                tint: tints[delay % tints.length]
            });
        }
    }

    destroy() {

        this.root.removeEventListener('avatarstatechange', this.handleStateChange);
        this.root.removeEventListener('avatarcelebrate', this.handleCelebrate);
        document.removeEventListener('visibilitychange', this.handleVisibility);

        this.root.classList.remove('avatar--animated');
        delete this.root.dataset.animatedAvatar;

        this.hud?.remove();
        this.hud = null;

        if (this.app) {
            try {
                this.app.destroy({ removeView: true }, { children: true });
            } catch {
                // La aplicación pudo no terminar de inicializarse.
            }

            this.app = null;
        }

        /* Poses que terminen de cargar después de esto se ignoran. */
        this.figure = null;
        this.poseMeshes.clear();

        for (const texture of this.textures) {
            texture.destroy(true);
        }

        this.textures = [];

        this.readingCards?.destroy();
        this.readingCards = null;

        this.host?.remove();
        this.host = null;

        this.sparks = null;
    }

    async #init(imageUrl) {

        /*
         * Antes de cualquier await: los cambios de estado que
         * lleguen mientras carga PixiJS no deben perderse.
         */
        this.root.addEventListener('avatarstatechange', this.handleStateChange);
        this.root.addEventListener('avatarcelebrate', this.handleCelebrate);
        document.addEventListener('visibilitychange', this.handleVisibility);

        this.host = document.createElement('div');
        this.host.className = 'avatar-canvas';
        this.root.appendChild(this.host);

        this.app = new Application();

        await this.app.init({
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            resizeTo: this.host,
            preference: 'webgl'
        });

        this.host.appendChild(this.app.canvas);

        this.app.ticker.maxFPS = this.maxFPS;

        /*
         * Las poses se descargan en paralelo pero NO bloquean el arranque:
         * el mago aparece con la base y cada pose se suma al llegar.
         * Si una falla, el mago sigue funcionando con las demás.
         */
        const posesLoading = Object.entries(POSE_FILES).map(([key, file]) =>
            Assets.load(new URL(file, imageUrl).href).then(
                poseTexture => ({ key, poseTexture }),
                error => console.warn(`Pose no disponible (${file}):`, error)
            )
        );

        const texture = await Assets.load(imageUrl);

        this.#buildScene(texture);

        for (const loading of posesLoading) {
            loading.then(pose => {
                if (pose && this.figure && !this.figure.destroyed) {
                    this.#addPose(pose.key, pose.poseTexture);
                }
            });
        }

        this.app.ticker.add(ticker => {
            this.#update(Math.min(ticker.deltaMS / 1000, 0.1));
        });

        if (this.debug) {
            this.#createDebugTools();
        }

        /* Recién ahora se oculta el avatar CSS: nunca queda la escena vacía. */
        this.root.classList.add('avatar--animated');
        this.root.dataset.animatedAvatar = 'ready';
    }

    #buildScene(characterTexture) {

        const glow = createGlowTexture();
        const spark = createSparkTexture();
        const ring = createRingTexture();
        const swirl = createSwirlTexture();

        this.textures.push(glow, spark, ring, swirl);

        this.world = new Container();
        this.app.stage.addChild(this.world);

        /* Aura detrás del mago. */
        this.aura = this.#glowSprite(glow, ANCHORS.aura, 1100, COLORS.violet);

        /* Mago: malla deformable. */
        this.mesh = new MeshPlane({
            texture: characterTexture,
            verticesX: MESH_VERTICES.x,
            verticesY: MESH_VERTICES.y
        });

        this.mesh.autoResize = false;

        this.positionBuffer = this.mesh.geometry.getAttribute('aPosition').buffer;

        this.rig = createRig({
            base: this.positionBuffer.data,
            deformers: DEFORMERS,
            pins: PINS
        });

        /*
         * Poses: comparten la MISMA geometría que la base, así
         * respiración, boca y parpadeo las mueven igual.
         */
        this.figure = new Container();
        this.figure.sortableChildren = true;
        this.figure.addChild(this.mesh);
        this.poseMeshes.set(BASE_POSE, this.mesh);

        /* Bola de cristal. */
        const { ball } = ANCHORS;

        this.ballGlow = this.#glowSprite(glow, ball, ball.radius * 3.4, COLORS.cyan);

        this.swirl = new Container();
        this.swirl.position.set(ball.x, ball.y);

        const swirlMask = new Graphics()
            .circle(0, 0, ball.radius * 0.92)
            .fill(0xffffff);

        this.swirl.addChild(swirlMask);
        this.swirl.mask = swirlMask;

        this.swirlArms = [COLORS.violet, COLORS.cyan].map((tint, index) => {
            const arm = new Sprite(swirl);

            arm.anchor.set(0.5);
            arm.blendMode = 'add';
            arm.tint = tint;
            arm.width = ball.radius * (index === 0 ? 2.1 : 1.7);
            arm.height = arm.width;

            this.swirl.addChild(arm);

            return arm;
        });

        this.ballCore = this.#glowSprite(spark, ball, 150, 0xffffff);

        this.eyeGlows = ANCHORS.eyes.map(eye =>
            this.#glowSprite(glow, eye, 46, COLORS.violet)
        );

        this.rings = new RingPool({ texture: ring });
        this.sparks = new SparkPool({ texture: spark });
        this.glints = new CardGlints({ texture: spark, positions: ANCHORS.cards });

        this.readingCards = new FloatingCards({
            glowTexture: glow,
            origin: ball,
            slots: ANCHORS.readingSlots,
            onSparkle: (x, y, count) => this.#emitCardSparks(x, y, count)
        });

        this.world.addChild(
            this.aura,
            this.figure,
            this.ballGlow,
            this.swirl,
            this.ballCore,
            ...this.eyeGlows,
            this.rings.container,
            this.glints.container,
            this.readingCards.container,
            this.sparks.container
        );
    }

    #glowSprite(texture, { x, y }, size, tint) {

        const sprite = new Sprite(texture);

        sprite.anchor.set(0.5);
        sprite.blendMode = 'add';
        sprite.tint = tint;
        sprite.width = size;
        sprite.height = size;
        sprite.position.set(x, y);
        sprite.baseScale = sprite.scale.x;

        return sprite;
    }

    #layout() {

        const { width, height } = this.app.screen;

        if (width === this.layoutSize.width && height === this.layoutSize.height) {
            return;
        }

        this.layoutSize = { width, height };

        /* Igual que object-fit: contain del avatar CSS. */
        const scale = Math.min(
            width / TEXTURE_SIZE.width,
            height / TEXTURE_SIZE.height
        );

        this.world.scale.set(scale);

        this.world.position.set(
            (width - TEXTURE_SIZE.width * scale) / 2,
            (height - TEXTURE_SIZE.height * scale) / 2
        );
    }

    #update(dt) {

        const startedAt = this.hud ? performance.now() : 0;

        this.time += dt;

        this.#layout();

        const target = STATE_PROFILES[this.state];
        const blend = 1 - Math.exp(-dt * 3.5);

        for (const key in target) {
            this.values[key] += (target[key] - this.values[key]) * blend;
        }

        const speaking = this.state === 'speaking';
        const talk = this.speech.update(dt, speaking);

        this.#updatePoses(dt);

        /* Las cartas SOLO se mueven en lecturas de tarot. */
        if (speaking && this.intent === 'tarot_reading') {
            this.readingCards.start();
        } else {
            this.readingCards.stop();
        }

        this.celebration = Math.max(0, this.celebration - dt / CELEBRATION_S);

        const cheer = riseAndFall(this.celebration);

        this.#updateRig(dt, talk, cheer);
        this.#updateEffects(dt, target, talk, cheer);

        if (this.hud) {
            this.#updateHud(dt, performance.now() - startedAt);
        }
    }

    /*
     * Pide una pose. Si su imagen aún no cargó se muestra la base,
     * y #addPose la activa cuando llegue (si sigue siendo la pedida).
     */
    #showPose(key) {

        this.wantedPose = key;

        const shown = this.poseMeshes.has(key) ? key : BASE_POSE;

        if (this.poses.setTarget(shown)) {
            this.poseKick = 1;
        }
    }

    #addPose(key, texture) {

        /* Comparte la geometría de la base: el rig la mueve igual. */
        const poseMesh = new Mesh({ geometry: this.mesh.geometry, texture });

        poseMesh.visible = false;

        this.figure.addChild(poseMesh);
        this.poseMeshes.set(key, poseMesh);

        if (this.wantedPose === key) {
            this.#showPose(key);
        }
    }

    #updatePoses(dt) {

        this.poses.update(dt);
        this.poseKick = Math.max(0, this.poseKick - dt / POSE_KICK_S);

        const order = this.poses.order();

        for (const [key, poseMesh] of this.poseMeshes) {
            const alpha = this.poses.alphaOf(key);

            poseMesh.alpha = alpha;
            poseMesh.visible = alpha > 0;
            poseMesh.zIndex = order.indexOf(key);
        }
    }

    #updateRig(dt, talk, cheer) {

        const t = this.time;
        const v = this.values;
        const r = this.rigValues;

        /* Rebote breve al cambiar de pose. */
        const kick = riseAndFall(this.poseKick);

        r.breath.sy = 1 + Math.sin(t * 1.37) * 0.0055 + cheer * 0.004 + kick * 0.012;

        r.head.angle =
            (Math.sin(t * 0.63) * 0.007 + Math.sin(t * 1.71) * 0.0025) * v.headSway +
            v.lean +
            talk * 0.012 * Math.sin(t * 5.3) -
            kick * 0.012 -
            cheer * 0.02;

        r.hatTip.dx = Math.sin(t * 1.25) * 5 + Math.sin(t * 0.41) * 3;
        r.hatTip.dy = Math.cos(t * 1.25) * 1.6;

        r.jaw.dy = talk * 15;

        r.beard.dx = Math.sin(t * 1.05) * 2.4 + talk * Math.sin(t * 11) * 1.2;
        r.beard.dy = talk * 3;

        const blink = this.#updateTwitch(dt, 'blink', BLINK_S, 2.2, 5.5) * 0.9;

        r.blinkLeft.amount = blink;
        r.blinkRight.amount = blink;

        /* Manos: flotan sobre la bola y suben al celebrar. */
        const lift = cheer * 16;

        r.handLeft.dx = Math.sin(t * 1.3) * 2.5 * v.hands;
        r.handLeft.dy = Math.cos(t * 1.7) * 2.5 * v.hands - lift;

        r.handRight.dx = Math.sin(t * 1.3 + 2.1) * 2.5 * v.hands;
        r.handRight.dy = Math.cos(t * 1.55 + 1.2) * 2.5 * v.hands - lift;

        r.catHead.angle = Math.sin(t * 0.37) * 0.02 + Math.sin(t * 1.9) * 0.004;
        r.catEar.angle = this.#updateTwitch(dt, 'ear', EAR_TWITCH_S, 4, 11) * -0.22;

        r.flame.sx = 1 + Math.sin(t * 23) * 0.04 + Math.sin(t * 37) * 0.03;
        r.flame.sy = 1 + Math.sin(t * 17) * 0.07 + Math.sin(t * 29) * 0.05;

        r.smoke.dx = Math.sin(t * 0.8) * 7 + Math.sin(t * 2.3) * 2;

        /* Zonas que solo coinciden con la imagen base (wizardRig: baseOnly). */
        const base = this.poses.visibilityOf(BASE_POSE);

        for (const { name, kind } of BASE_ONLY_DEFORMERS) {
            weightRigValue(kind, r[name], base);
        }

        applyRig(this.rig, this.positionBuffer.data, r);
        this.positionBuffer.update();
    }

    #updateEffects(dt, target, talk, cheer) {

        const t = this.time;
        const v = this.values;
        const { ball } = ANCHORS;

        this.aura.alpha = v.aura * (0.85 + 0.15 * Math.sin(t * 1.2)) + cheer * 0.3;

        this.ballGlow.alpha = Math.min(
            1,
            v.glow * (0.85 + 0.15 * Math.sin(t * 3.1)) + talk * 0.25 + cheer * 0.6
        );

        this.ballGlow.scale.set(
            this.ballGlow.baseScale * (1 + talk * 0.08 + cheer * 0.25)
        );

        this.swirlArms[0].rotation += dt * v.swirl;
        this.swirlArms[1].rotation -= dt * v.swirl * 0.7;
        this.swirl.alpha = Math.min(1, 0.25 + v.glow * 0.55 + cheer * 0.3);

        this.ballCore.alpha = Math.min(1, 0.3 + v.glow * 0.5 + talk * 0.3);
        this.ballCore.rotation += dt * 0.4;
        this.ballCore.scale.set(
            this.ballCore.baseScale * (0.9 + 0.1 * Math.sin(t * 2.3) + cheer * 0.5)
        );

        for (const eyeGlow of this.eyeGlows) {
            eyeGlow.alpha = v.eyeGlow * (0.6 + 0.4 * Math.sin(t * 4));
        }

        /* Chispas que suben desde la bola. */
        this.timers.spark += dt * (v.sparks + talk * 8);

        while (this.timers.spark >= 1) {
            this.timers.spark -= 1;
            this.#emitBallSpark();
        }

        /* Ondas de energía (escuchando, pensando, reaccionando). */
        if (target.ringEvery > 0) {
            this.timers.ring += dt;

            if (this.timers.ring >= target.ringEvery) {
                this.timers.ring = 0;

                this.rings.emit({
                    x: ball.x,
                    y: ball.y,
                    from: (ball.radius / RING_TEXTURE_RADIUS) * 0.95,
                    to: (ball.radius / RING_TEXTURE_RADIUS) * 2.6,
                    life: 1.3,
                    alpha: 0.45,
                    tint: Math.random() < 0.5 ? COLORS.violet : COLORS.cyan
                });
            }
        } else {
            this.timers.ring = 0;
        }

        /* Destellos ocasionales en las cartas; más seguidos al pensar. */
        this.timers.glint -= dt * (1 + v.swirl * 0.6);

        if (this.timers.glint <= 0) {
            this.timers.glint = randomBetween(2.5, 6);
            this.glints.trigger(Math.floor(Math.random() * this.glints.count));
        }

        this.sparks.update(dt);
        this.rings.update(dt);
        this.glints.update(dt);
        this.readingCards.update(dt, talk);
    }

    #emitCardSparks(x, y, count) {

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = randomBetween(40, 180);

            this.sparks.emit({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 40,
                life: randomBetween(0.6, 1.2),
                scale: randomBetween(0.2, 0.45),
                tint: pick(CELEBRATION_TINTS.gift),
                drag: 2
            });
        }
    }

    #emitBallSpark() {

        const { ball } = ANCHORS;
        const angle = Math.random() * Math.PI * 2;
        const radius = ball.radius * 0.95;

        this.sparks.emit({
            x: ball.x + Math.cos(angle) * radius,
            y: ball.y + Math.sin(angle) * radius,
            vx: Math.cos(angle) * 18 + randomBetween(-10, 10),
            vy: -30 - Math.random() * 45,
            life: randomBetween(1.4, 2.6),
            scale: randomBetween(0.18, 0.4),
            tint: pick(BALL_SPARK_TINTS),
            drag: 0.2
        });
    }

    /*
     * Gesto breve que se repite a intervalos aleatorios
     * (parpadeo, oreja del gato). Devuelve 0..1..0.
     */
    #updateTwitch(dt, key, durationS, minGapS, maxGapS) {

        const timers = this.timers;
        const phaseKey = `${key}Phase`;

        if (timers[phaseKey] >= 0) {
            timers[phaseKey] += dt;

            if (timers[phaseKey] >= durationS) {
                timers[phaseKey] = -1;
                return 0;
            }

            return Math.sin(Math.PI * timers[phaseKey] / durationS);
        }

        timers[key] -= dt;

        if (timers[key] <= 0) {
            timers[key] = randomBetween(minGapS, maxGapS);
            timers[phaseKey] = 0;
        }

        return 0;
    }

    /* ============================================================
       DEBUG (?debug=1 o ?debug=anchors)
       ============================================================ */

    #createDebugTools() {

        this.hud = document.createElement('div');
        this.hud.className = 'avatar-debug-hud';
        document.body.appendChild(this.hud);

        this.hudStats = { elapsed: 0, frames: 0, scriptMs: 0 };

        if (this.debug === 'anchors') {
            this.world.addChild(this.#createAnchorOverlay());
        }
    }

    #updateHud(dt, scriptMs) {

        const stats = this.hudStats;

        stats.elapsed += dt;
        stats.frames += 1;
        stats.scriptMs += scriptMs;

        if (stats.elapsed < 0.5) {
            return;
        }

        this.hud.textContent =
            `Avatar animado · ${Math.round(this.app.ticker.FPS)} FPS · ` +
            `JS ${(stats.scriptMs / stats.frames).toFixed(2)} ms/frame · ` +
            `${MESH_VERTICES.x * MESH_VERTICES.y} vértices · estado: ${this.state} · pose: ${this.poses.current}`;

        stats.elapsed = 0;
        stats.frames = 0;
        stats.scriptMs = 0;
    }

    #createAnchorOverlay() {

        const overlay = new Graphics();

        for (const { area } of DEFORMERS) {
            overlay.ellipse(area.cx, area.cy, area.rx, area.ry).stroke({ width: 2, color: 0x00ff88 });
        }

        for (const pin of PINS) {
            if (pin.belowY !== undefined) {
                overlay.rect(0, pin.belowY, TEXTURE_SIZE.width, 2).fill(0xff4466);
            } else {
                overlay.ellipse(pin.cx, pin.cy, pin.rx, pin.ry).stroke({ width: 2, color: 0xff4466 });
            }
        }

        for (const point of [...ANCHORS.eyes, ...ANCHORS.cards, ...ANCHORS.hands, ANCHORS.ball]) {
            overlay.circle(point.x, point.y, 6).fill(0xffee00);
        }

        return overlay;
    }
}
