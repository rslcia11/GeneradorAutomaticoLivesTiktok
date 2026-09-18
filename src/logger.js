const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

export function createLogger({ level = process.env.LOG_LEVEL } = {}) {
    const threshold = LEVELS[level?.toUpperCase().trim()] ?? LEVELS.INFO;
    const ts = () => new Date().toISOString();

    return {
        debug: (msg, ...a) => { if (threshold <= LEVELS.DEBUG) console.log(`[${ts()}] DEBUG ${msg}`, ...a); },
        info:  (msg, ...a) => { if (threshold <= LEVELS.INFO)  console.log(`[${ts()}] INFO  ${msg}`, ...a); },
        warn:  (msg, ...a) => { if (threshold <= LEVELS.WARN)  console.warn(`[${ts()}] WARN  ${msg}`, ...a); },
        error: (msg, ...a) => { if (threshold <= LEVELS.ERROR) console.error(`[${ts()}] ERROR ${msg}`, ...a); },
    };
}

export const logger = createLogger();
