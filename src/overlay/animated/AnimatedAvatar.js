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
import { CardGlints, RingPool, SmokePool, SparkPool } from './effects.js';
import { SpeechLevel } from './speech.js';
import { FloatingCards } from './tarotCards.js';
import { BASE_POSE, POSE_FILES, PoseBlender, selectPose } from './poses.js';
import { currentStageScale, renderResolution } from '../stage.js';

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

const MAGIC_TRICKS = Object.freeze([
    { emoji: '🕊️', label: 'Paloma',         tint: 0xffffff,  tints: [0xffffff, 0xd0e8ff] },
    { emoji: '🐭', label: 'Ratón',           tint: 0xddccdd,  tints: [0xddccdd, 0xffffff] },
    { emoji: '🐇', label: 'Conejo',          tint: 0xffeeff,  tints: [0xffeeff, 0xffffff] },
    { emoji: '🦋', label: 'Mariposa',        tint: 0x8fe3ff,  tints: [0x8fe3ff, 0xff9ad5] },
    { emoji: '🌸', label: 'Flor de cerezo',  tint: 0xff9ad5,  tints: [0xff9ad5, 0xffffff] },
    { emoji: '⭐', label: 'Estrella',         tint: 0xffd98a,  tints: [0xffd98a, 0xffffff] },
    { emoji: '🍄', label: 'Hongo mágico',    tint: 0xff7777,  tints: [0xff7777, 0xffd98a] },
    { emoji: '🦉', label: 'Búho sabio',      tint: 0xc8a870,  tints: [0xc8a870, 0xffd98a] },
    { emoji: '🐍', label: 'Serpiente',       tint: 0x88ff88,  tints: [0x88ff88, 0xffd98a] },
    { emoji: '🔮', label: 'Orbe místico',    tint: 0xa87bff,  tints: [0xa87bff, 0x8fe3ff] },
]);

/* Fases del truco y su duración en segundos. */
const TRICK_PHASES = Object.freeze({
    raise:  0.7,   /* mano sube */
    wave:   1.0,   /* arco + chispas */
    burst:  0.25,  /* explosión */
    reveal: 2.5,   /* emoji flota */
    return: 0.8    /* mano baja */
});

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

    static async create({ root, imageUrl, initialState = 'idle', initialIntent = null, maxFPS = 60, debug = null, onCardReveal = null }) {

        if (!isWebGLSupported()) {
            throw new Error('WebGL no está disponible en este navegador');
        }

        const avatar = new AnimatedAvatar({ root, initialState, initialIntent, maxFPS, debug, onCardReveal });

        try {
            await avatar.#init(imageUrl);
        } catch (error) {
            avatar.destroy();
            throw error;
        }

        return avatar;
    }

    constructor({ root, initialState, initialIntent, maxFPS, debug, onCardReveal = null }) {

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

        /* 0..1, cuánta vida pide el director de sala (evento scene_mood). */
        this.energy = 0.5;


        this.speech = new SpeechLevel();

        this.timers = {
            spark: 0,
            ring: 0,
            blink: randomBetween(1.5, 4),
            blinkPhase: -1,
            ear: randomBetween(4, 9),
            earPhase: -1,
            glint:      randomBetween(2, 5),
            cardHover: 0,
            smoke:      [0, 0]   /* timer independiente por vela */
        };

        /* Truco mágico periódico. */
        this.trick = {
            timer:   randomBetween(8, 12),     /* segundos hasta el próximo truco */
            phase:   null,
            phaseT:  0,
            current: null,                    /* MAGIC_TRICKS entry */
            wand:    { dx: 0, dy: 0 },        /* sobreescritura de la mano derecha */
            burstDone: false
        };

        /* Comportamiento de la cabeza del gato. */
        this.catLook = {
            angle:      0,
            target:     0,
            speed:      3,
            holdTimer:  randomBetween(1, 3),
            slowDownIn: 0   /* segundos hasta bajar la velocidad post-snap */
        };

        /* Timer para reiniciar las cartas de la mesa periódicamente. */
        this.timers.tableRestart = randomBetween(55, 85);
        this.tableCardsRestarting = false;

        this.rigValues = Object.fromEntries(
            DEFORMERS.map(deformer => [deformer.name, {}])
        );

        this.onCardReveal = typeof onCardReveal === 'function' ? onCardReveal : null;

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

        /* El escenario cambió de escala: se redibuja a la nueva nitidez. */
        this.handleStageScale = event => {
            const renderer = this.app?.renderer;

            if (!renderer || !this.host) {
                return;
            }

            renderer.resize(
                this.host.clientWidth,
                this.host.clientHeight,
                renderResolution(event.detail?.scale ?? 1, window.devicePixelRatio)
            );
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

    /** Cuánta vida tiene la escena en reposo (0..1). La manda el backend. */
    setEnergy(energy) {
        if (Number.isFinite(energy)) {
            this.energy = Math.min(1, Math.max(0, energy));
        }
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

        this.#burstSparks(ball.x, ball.y, {
            count: 46,
            speed: [160, 420],
            lift: 60,
            life: [0.9, 1.6],
            scale: [0.3, 0.65],
            tints,
            drag: 2.2,
            spin: 4
        });

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
        window.removeEventListener('stagescale', this.handleStageScale);

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

        this.tableCards?.destroy();
        this.tableCards = null;

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
        window.addEventListener('stagescale', this.handleStageScale);

        this.host = document.createElement('div');
        this.host.className = 'avatar-canvas';
        this.root.appendChild(this.host);

        this.app = new Application();

        await this.app.init({
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            /* El escenario puede verse ×2 (OBS 1080 × 1920): se dibuja a esa nitidez. */
            resolution: renderResolution(currentStageScale(), window.devicePixelRatio),
            resizeTo: this.host,
            preference: 'webgl'
        });

        this.host.appendChild(this.app.canvas);

        /*
         * La escala pudo cambiar mientras arrancaba PixiJS (el aviso se
         * pierde porque todavía no existe el renderer). Se vuelve a aplicar
         * aquí: si no, en OBS el mago podría quedar borroso para siempre.
         */
        this.handleStageScale({ detail: { scale: currentStageScale() } });

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
        this.swirl.sortableChildren = true;
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

        /* Orbes que orbitan dentro de la bola, enmascarados al círculo. */
        const ORB_DEFS = [
            { r: 0.52, speed:  0.38, phase: 0,    tint: COLORS.violet, px: 66 },
            { r: 0.33, speed: -0.57, phase: 2.1,  tint: COLORS.cyan,   px: 44 },
            { r: 0.66, speed:  0.24, phase: 4.2,  tint: COLORS.gold,   px: 54 },
            { r: 0.44, speed: -0.35, phase: 1.05, tint: COLORS.violet, px: 38 }
        ];

        this.ballOrbs = ORB_DEFS.map(def => {
            const sprite = new Sprite(glow);

            sprite.anchor.set(0.5);
            sprite.blendMode = 'add';
            sprite.tint = def.tint;
            sprite.width  = def.px;
            sprite.height = def.px;

            this.swirl.addChild(sprite);

            return { sprite, r: def.r * ball.radius, speed: def.speed, phase: def.phase };
        });

        this.ballCore = this.#glowSprite(spark, ball, 150, 0xffffff);

        this.eyeGlows = ANCHORS.eyes.map(eye =>
            this.#glowSprite(glow, eye, 46, COLORS.violet)
        );

        this.rings  = new RingPool({ texture: ring });
        this.sparks = new SparkPool({ texture: spark });
        this.smoke  = new SmokePool({ texture: glow });
        this.glints = new CardGlints({ texture: spark, positions: ANCHORS.cards });

        this.readingCards = new FloatingCards({
            glowTexture: glow,
            origin: ball,
            slots: ANCHORS.readingSlots,
            onSparkle: (x, y, count) => this.#emitCardSparks(x, y, count),
            onReveal: (x, y, tint, name) => this.#celebrateReveal(x, y, tint, name)
        });

        /* Las 5 cartas de la mesa — viven siempre en hover/shuffle. */
        this.tableCards = new FloatingCards({
            glowTexture: glow,
            origin: ball,
            slots: ANCHORS.tableSlots,
            onSparkle: (x, y, count) => this.#emitCardSparks(x, y, count),
            onReveal: () => {}
        });

        /* Esfera armilar: 3 anillos 3D giratorios en coordenadas del mundo.
         * Posición estimada (200, 384) = escena (110, 250) con scale=0.5505.
         * Ajustar ARM_X / ARM_Y si la posición visual no coincide. */
        const ARM_X = 200, ARM_Y = 384, ARM_R = 40;
        const ARM_DEFS = [
            { speed:  0.55, t: 0,             axis: 'y', tilt: 0   },
            { speed: -0.38, t: Math.PI * 0.5, axis: 'x', tilt: 0   },
            { speed:  0.72, t: Math.PI * 0.2, axis: 'y', tilt: 0.7 }
        ];
        this.armRings = ARM_DEFS.map(def => {
            const c = new Container();
            c.position.set(ARM_X, ARM_Y);
            c.rotation  = def.tilt;
            c.blendMode = 'add';

            const g = new Graphics()
                .ellipse(0, 0, ARM_R, ARM_R * 0.82)
                .stroke({ width: 2.5, color: 0xffcc33, alpha: 0.78 });

            c.addChild(g);

            return { c, t: def.t, speed: def.speed, axis: def.axis };
        });

        this.world.addChild(
            this.aura,
            ...this.armRings.map(r => r.c),
            this.figure,
            this.smoke.container,
            this.ballGlow,
            this.swirl,
            this.ballCore,
            ...this.eyeGlows,
            this.rings.container,
            this.glints.container,
            /* Cartas de mesa (detrás del scrim de lectura). */
            this.tableCards.container,
            /* Scrim y cartas de lectura encima. */
            this.readingCards.scrim,
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

        /*
         * Con la sala callada la escena se mueve más (el backend manda
         * `scene_mood`): un LIVE quieto aburre y TikTok lo penaliza.
         * En reposo se nota; mientras habla o piensa, casi nada.
         */
        const lift = this.state === 'idle' || this.state === 'listening'
            ? 0.65 + this.energy * 0.7
            : 1;

        for (const key in target) {
            const wanted = key === 'ringEvery' && target[key] > 0
                ? target[key] / lift
                : target[key] * (key === 'lean' ? 1 : lift);

            this.values[key] += (wanted - this.values[key]) * blend;
        }

        const speaking = this.state === 'speaking';
        const talk = this.speech.update(dt, speaking);

        this.#updatePoses(dt);

        this.#updateReadingCards(dt, speaking);
        this.#updateTableCards(dt);
        this.#updateMagicTrick(dt);
        this.#updateArmillary(dt);

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

        r.handRight.dx = Math.sin(t * 1.3 + 2.1) * 2.5 * v.hands + this.trick.wand.dx;
        r.handRight.dy = Math.cos(t * 1.55 + 1.2) * 2.5 * v.hands - lift + this.trick.wand.dy;

        this.#updateCatLook(dt);
        r.catHead.angle = this.catLook.angle + Math.sin(t * 0.37) * 0.01 + Math.sin(t * 1.9) * 0.004;
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

    #updateReadingCards(dt, speaking) {

        const isReading = speaking && this.intent === 'tarot_reading';

        if (isReading) {
            this.timers.cardHover = 0;
            this.readingCards.start();
            return;
        }

        /* Auto-dismiss: 5 s en hover y la carta vuelve a la baraja. */
        if (this.readingCards.phase === 'hover') {
            this.timers.cardHover += dt;
            if (this.timers.cardHover >= 5) {
                this.readingCards.stop();
                this.timers.cardHover = 0;
            }
        }
    }

    #updateTableCards(_dt) {}

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

        /* Orbes orbitales dentro de la bola.
         * Perspectiva simple: eje X plano, eje Y aplastado (×0.45).
         * depth = sin(ángulo): +1 = frente (más brillante), -1 = detrás. */
        for (const orb of this.ballOrbs) {
            const angle = t * orb.speed * (1 + v.swirl * 0.35) + orb.phase;
            const depth = Math.sin(angle);                 /* -1..+1 */

            orb.sprite.x = Math.cos(angle) * orb.r * 0.75;
            orb.sprite.y = depth * orb.r * 0.42;

            /* Los de detrás quedan más opacos/pequeños. */
            orb.sprite.alpha = v.glow * (0.22 + 0.55 * (depth * 0.5 + 0.5)) + cheer * 0.2;
            const sz = 0.85 + 0.18 * (depth * 0.5 + 0.5);
            orb.sprite.scale.set(sz);

            /* zIndex: los de detrás se dibujan primero. */
            orb.sprite.zIndex = depth;
        }

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

        /* Humo de las velas. */
        ANCHORS.candles.forEach((candle, i) => {

            this.timers.smoke[i] -= dt;

            if (this.timers.smoke[i] <= 0) {
                this.timers.smoke[i] = randomBetween(0.35, 0.7);

                this.smoke.emit({
                    x:          candle.x + randomBetween(-4, 4),
                    y:          candle.y,
                    vx:         randomBetween(-12, 12),
                    vy:         randomBetween(-38, -22),
                    life:       randomBetween(2.5, 4.2),
                    scaleStart: randomBetween(0.12, 0.22),
                    scaleEnd:   randomBetween(0.55, 0.85),
                    alpha:      randomBetween(0.14, 0.24),
                    tint:       0xc8c8d8
                });
            }
        });

        this.smoke.update(dt);
        this.sparks.update(dt);
        this.rings.update(dt);
        this.glints.update(dt);
        this.tableCards?.update(dt, talk);
        this.readingCards.update(dt, talk);
    }

    /* El golpe visual del volteo: onda de choque + lluvia de chispas. */
    #celebrateReveal(x, y, tint, name = '') {
        if (this.onCardReveal && name) {
            this.onCardReveal(name);
        }

        /* Escalas relativas a RING_TEXTURE_RADIUS: ~27 px → ~170 px. */
        this.rings.emit({
            x,
            y,
            from: 0.25,
            to: 1.6,
            life: 0.75,
            alpha: 0.85,
            tint
        });

        this.#burstSparks(x, y, {
            count: 26,
            speed: [120, 360],
            lift: 50,
            life: [0.7, 1.3],
            scale: [0.22, 0.5],
            tints: [tint, COLORS.gold],
            drag: 2.4,
            spin: 5
        });
    }

    #emitCardSparks(x, y, count) {
        this.#burstSparks(x, y, {
            count,
            speed: [40, 180],
            lift: 40,
            life: [0.6, 1.2],
            scale: [0.2, 0.45],
            tints: CELEBRATION_TINTS.gift,
            drag: 2
        });
    }

    /* Chispas que salen en todas direcciones desde un punto. */
    #burstSparks(x, y, { count, speed, lift, life, scale, tints, drag, spin = 0 }) {

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const velocity = randomBetween(...speed);

            this.sparks.emit({
                x,
                y,
                vx: Math.cos(angle) * velocity,
                vy: Math.sin(angle) * velocity - lift,
                life: randomBetween(...life),
                scale: randomBetween(...scale),
                tint: pick(tints),
                drag,
                spin: randomBetween(-spin, spin)
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

    #updateMagicTrick(dt) {

        const tr = this.trick;

        if (!tr.phase) {
            /* Cuenta regresiva; no interrumpir lecturas activas. */
            if (this.readingCards.active) return;

            tr.timer -= dt;

            if (tr.timer > 0) return;

            /* ¡Truco! */
            tr.current   = pick(MAGIC_TRICKS);
            tr.phase     = 'raise';
            tr.phaseT    = 0;
            tr.burstDone = false;
            tr.wand      = { dx: 0, dy: 0 };
            return;
        }

        tr.phaseT += dt;

        const dur = TRICK_PHASES[tr.phase];
        const p   = Math.min(1, tr.phaseT / dur);
        const ease = t => 1 - (1 - t) ** 3;

        switch (tr.phase) {

            case 'raise':
                /* Mano sube suavemente. */
                tr.wand.dy = -ease(p) * 90;
                tr.wand.dx =  ease(p) * 18;
                break;

            case 'wave':
                /* Arco de barita: dx oscila, dy se mantiene arriba. */
                tr.wand.dy = -90 + Math.sin(p * Math.PI) * -35;
                tr.wand.dx =  18 + Math.sin(p * Math.PI * 3) * 30;

                /* Chispas durante el arco. */
                if (Math.random() < dt * 14) {
                    const { hands } = ANCHORS;
                    this.#burstSparks(
                        hands[1].x + tr.wand.dx,
                        hands[1].y + tr.wand.dy,
                        { count: 3, speed: [60, 180], lift: 30,
                          life: [0.4, 0.9], scale: [0.18, 0.38],
                          tints: tr.current.tints, drag: 2.5, spin: 4 }
                    );
                }
                break;

            case 'burst':
                if (!tr.burstDone) {
                    tr.burstDone = true;
                    const { hands } = ANCHORS;
                    const bx = hands[1].x + tr.wand.dx;
                    const by = hands[1].y + tr.wand.dy - 20;

                    this.#burstSparks(bx, by, {
                        count: 55, speed: [140, 400], lift: 70,
                        life: [0.8, 1.6], scale: [0.28, 0.65],
                        tints: tr.current.tints, drag: 2.2, spin: 5
                    });

                    this.rings.emit({ x: bx, y: by,
                        from: 0.2, to: 2.8, life: 1.0, alpha: 0.9,
                        tint: tr.current.tint });

                    this.rings.emit({ x: bx, y: by,
                        from: 0.1, to: 1.6, life: 0.6, alpha: 0.7,
                        tint: 0xffffff });

                    this.#showTrickEmoji(tr.current);
                }
                break;

            case 'reveal':
                /* Mano baja gradualmente. */
                tr.wand.dy = -90 * (1 - ease(p * 0.6));
                tr.wand.dx =  18 * (1 - ease(p * 0.6));
                break;

            case 'return':
                /* Suavizado final a cero. */
                tr.wand.dy = tr.wand.dy * (1 - dt * 6);
                tr.wand.dx = tr.wand.dx * (1 - dt * 6);
                break;
        }

        /* Avanzar fase. */
        if (p >= 1) {
            const phases = Object.keys(TRICK_PHASES);
            const next   = phases[phases.indexOf(tr.phase) + 1] ?? null;

            tr.phase  = next;
            tr.phaseT = 0;

            if (!next) {
                tr.wand  = { dx: 0, dy: 0 };
                tr.timer = randomBetween(50, 80);
            }
        }
    }

    #showTrickEmoji(trick) {

        const el = document.createElement('div');

        el.className = 'magic-trick';
        el.innerHTML =
            `<span class="magic-trick__emoji">${trick.emoji}</span>` +
            `<span class="magic-trick__label">${trick.label}</span>`;

        document.body.appendChild(el);

        /* Forzar reflow para que la animación arranque. */
        el.getBoundingClientRect();
        el.classList.add('magic-trick--in');

        setTimeout(() => el.remove(), 3400);
    }

    #updateArmillary(dt) {

        for (const ring of this.armRings) {
            ring.t += dt * ring.speed;
            if (ring.axis === 'y') {
                ring.c.scale.x = Math.cos(ring.t);
            } else {
                ring.c.scale.y = Math.cos(ring.t);
            }
        }
    }

    #updateCatLook(dt) {

        const look = this.catLook;

        /* Bajar velocidad post-snap cuando toca. */
        if (look.slowDownIn > 0) {
            look.slowDownIn -= dt;

            if (look.slowDownIn <= 0) {
                look.speed = randomBetween(1.5, 3);
            }
        }

        /* Suavizado exponencial hacia el objetivo. */
        look.angle += (look.target - look.angle) * Math.min(1, dt * look.speed);

        look.holdTimer -= dt;

        if (look.holdTimer > 0) return;

        /* Giro brusco (double-take) 25% del tiempo. */
        const snap = Math.random() < 0.25;

        if (snap) {
            look.target     = Math.random() < 0.5 ? randomBetween(-0.28, -0.18) : randomBetween(0.18, 0.28);
            look.speed      = randomBetween(8, 14);
            look.holdTimer  = randomBetween(0.6, 1.8);
            look.slowDownIn = look.holdTimer + 0.1;
        } else {
            look.target    = randomBetween(-0.16, 0.16);
            look.speed     = randomBetween(2, 4);
            look.holdTimer = randomBetween(2, 6);
            look.slowDownIn = 0;
        }
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
