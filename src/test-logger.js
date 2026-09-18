import assert from 'node:assert/strict';
import { createLogger } from './logger.js';

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

function capture(fn) {
    const logs = [];
    const warns = [];
    const errors = [];
    const origLog   = console.log;
    const origWarn  = console.warn;
    const origError = console.error;
    console.log   = (...a) => logs.push(a.join(' '));
    console.warn  = (...a) => warns.push(a.join(' '));
    console.error = (...a) => errors.push(a.join(' '));
    try { fn(); } finally {
        console.log   = origLog;
        console.warn  = origWarn;
        console.error = origError;
    }
    return { logs, warns, errors };
}

// 1. Nivel INFO suprime DEBUG
test('INFO suprime debug', () => {
    const log = createLogger({ level: 'INFO' });
    const { logs } = capture(() => log.debug('oculto'));
    assert.equal(logs.length, 0);
});

// 2. Nivel INFO deja pasar info
test('INFO deja pasar info', () => {
    const log = createLogger({ level: 'INFO' });
    const { logs } = capture(() => log.info('visible'));
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('visible'));
});

// 3. Nivel INFO deja pasar warn
test('INFO deja pasar warn', () => {
    const log = createLogger({ level: 'INFO' });
    const { warns } = capture(() => log.warn('alerta'));
    assert.equal(warns.length, 1);
    assert.ok(warns[0].includes('alerta'));
});

// 4. Nivel WARN suprime info
test('WARN suprime info', () => {
    const log = createLogger({ level: 'WARN' });
    const { logs } = capture(() => log.info('silencioso'));
    assert.equal(logs.length, 0);
});

// 5. Nivel ERROR suprime warn
test('ERROR suprime warn', () => {
    const log = createLogger({ level: 'ERROR' });
    const { warns } = capture(() => log.warn('silencioso'));
    assert.equal(warns.length, 0);
});

// 6. Nivel ERROR deja pasar error
test('ERROR deja pasar error', () => {
    const log = createLogger({ level: 'ERROR' });
    const { errors } = capture(() => log.error('fallo'));
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('fallo'));
});

// 7. Nivel DEBUG deja pasar todo
test('DEBUG deja pasar debug, info, warn, error', () => {
    const log = createLogger({ level: 'DEBUG' });
    const { logs, warns, errors } = capture(() => {
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
    });
    assert.equal(logs.length, 2);   // debug + info
    assert.equal(warns.length, 1);  // warn
    assert.equal(errors.length, 1); // error
});

// 8. Nivel inválido se trata como INFO
test('Nivel inválido → INFO por defecto', () => {
    const log = createLogger({ level: 'INVALIDO' });
    const { logs: noLogs } = capture(() => log.debug('oculto'));
    const { logs: yesLogs } = capture(() => log.info('visible'));
    assert.equal(noLogs.length, 0);
    assert.equal(yesLogs.length, 1);
});

// 9. Sin nivel → INFO por defecto
test('Sin nivel → INFO por defecto', () => {
    const log = createLogger({});
    const { logs: noLogs } = capture(() => log.debug('oculto'));
    const { logs: yesLogs } = capture(() => log.info('visible'));
    assert.equal(noLogs.length, 0);
    assert.equal(yesLogs.length, 1);
});

// 10. Mensaje incluye timestamp ISO
test('Mensaje incluye timestamp ISO', () => {
    const log = createLogger({ level: 'INFO' });
    const { logs } = capture(() => log.info('hola'));
    assert.ok(logs[0].match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/), 'debe incluir fecha ISO');
});

// 11. Mensaje incluye el nivel en texto
test('Mensaje incluye el nivel en texto', () => {
    const log = createLogger({ level: 'DEBUG' });
    const out = capture(() => {
        log.debug('x');
        log.info('x');
        log.warn('x');
        log.error('x');
    });
    assert.ok(out.logs[0].includes('DEBUG'));
    assert.ok(out.logs[1].includes('INFO'));
    assert.ok(out.warns[0].includes('WARN'));
    assert.ok(out.errors[0].includes('ERROR'));
});

// 12. Acepta nivel en minúsculas
test('Acepta nivel en minúsculas', () => {
    const log = createLogger({ level: 'warn' });
    const { logs } = capture(() => log.info('silencioso'));
    assert.equal(logs.length, 0);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de logger superadas correctamente.`
);
