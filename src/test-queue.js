import assert from 'node:assert/strict';

import { PriorityQueue } from './rules/PriorityQueue.js';

let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

// 1. Cola nueva
test('Cola nueva → vacía', () => {
    const queue = new PriorityQueue();

    assert.equal(queue.size, 0);
    assert.equal(queue.isEmpty, true);
    assert.equal(queue.isFull, false);
});

// 2. FIFO con misma prioridad
test('Misma prioridad → FIFO', () => {
    const queue = new PriorityQueue();

    queue.enqueue('A', 50);
    queue.enqueue('B', 50);
    queue.enqueue('C', 50);

    assert.equal(queue.dequeue(), 'A');
    assert.equal(queue.dequeue(), 'B');
    assert.equal(queue.dequeue(), 'C');
});

// 3. Prioridad mayor primero
test('Mayor prioridad → sale primero', () => {
    const queue = new PriorityQueue();

    queue.enqueue('Comentario', 50);
    queue.enqueue('Regalo', 80);
    queue.enqueue('Baja', 10);

    assert.equal(queue.dequeue(), 'Regalo');
    assert.equal(queue.dequeue(), 'Comentario');
    assert.equal(queue.dequeue(), 'Baja');
});

// 4. FIFO también dentro de prioridad alta
test('Prioridad alta mantiene FIFO', () => {
    const queue = new PriorityQueue();

    queue.enqueue('Gift A', 80);
    queue.enqueue('Gift B', 80);
    queue.enqueue('Comentario', 50);

    assert.equal(queue.dequeue(), 'Gift A');
    assert.equal(queue.dequeue(), 'Gift B');
    assert.equal(queue.dequeue(), 'Comentario');
});

// 5. Respeta capacidad máxima
test('Nunca supera maxSize', () => {
    const queue = new PriorityQueue({
        maxSize: 3
    });

    queue.enqueue('A', 50);
    queue.enqueue('B', 50);
    queue.enqueue('C', 50);

    assert.equal(queue.size, 3);
    assert.equal(queue.isFull, true);
});

// 6. Cola llena rechaza misma prioridad
test('Cola llena + misma prioridad → rechaza nuevo', () => {
    const queue = new PriorityQueue({
        maxSize: 2
    });

    queue.enqueue('A', 50);
    queue.enqueue('B', 50);

    const result = queue.enqueue('C', 50);

    assert.equal(result.accepted, false);
    assert.equal(result.dropped, 'C');

    assert.equal(queue.size, 2);
    assert.equal(queue.dequeue(), 'A');
    assert.equal(queue.dequeue(), 'B');
});

// 7. Prioridad superior desplaza elemento inferior
test('Cola llena + prioridad mayor → reemplaza inferior', () => {
    const queue = new PriorityQueue({
        maxSize: 3
    });

    queue.enqueue('Comentario A', 50);
    queue.enqueue('Comentario B', 50);
    queue.enqueue('Baja', 10);

    const result = queue.enqueue('Regalo', 80);

    assert.equal(result.accepted, true);
    assert.equal(result.dropped, 'Baja');

    assert.equal(queue.size, 3);

    assert.equal(queue.dequeue(), 'Regalo');
    assert.equal(queue.dequeue(), 'Comentario A');
    assert.equal(queue.dequeue(), 'Comentario B');
});

// 8. Reemplaza el más nuevo entre los menos prioritarios
test('Reemplazo conserva el elemento antiguo', () => {
    const queue = new PriorityQueue({
        maxSize: 3
    });

    queue.enqueue('Baja antigua', 10);
    queue.enqueue('Baja nueva', 10);
    queue.enqueue('Comentario', 50);

    const result = queue.enqueue('Regalo', 80);

    assert.equal(result.accepted, true);
    assert.equal(result.dropped, 'Baja nueva');

    assert.equal(queue.dequeue(), 'Regalo');
    assert.equal(queue.dequeue(), 'Comentario');
    assert.equal(queue.dequeue(), 'Baja antigua');
});

// 9. peek no elimina
test('peek() consulta sin extraer', () => {
    const queue = new PriorityQueue();

    queue.enqueue('A', 50);
    queue.enqueue('B', 80);

    assert.equal(queue.peek(), 'B');
    assert.equal(queue.size, 2);

    assert.equal(queue.dequeue(), 'B');
});

// 10. dequeue sobre cola vacía
test('dequeue() vacía → null', () => {
    const queue = new PriorityQueue();

    assert.equal(queue.dequeue(), null);
});

// 11. peek sobre cola vacía
test('peek() vacía → null', () => {
    const queue = new PriorityQueue();

    assert.equal(queue.peek(), null);
});

// 12. clear
test('clear() vacía completamente', () => {
    const queue = new PriorityQueue();

    queue.enqueue('A', 50);
    queue.enqueue('B', 80);

    queue.clear();

    assert.equal(queue.size, 0);
    assert.equal(queue.isEmpty, true);
    assert.equal(queue.dequeue(), null);
});

// 13. snapshot no modifica la cola
test('snapshot() devuelve diagnóstico sin extraer', () => {
    const queue = new PriorityQueue();

    queue.enqueue('Comentario', 50);
    queue.enqueue('Regalo', 80);

    const snapshot = queue.snapshot();

    assert.equal(snapshot.length, 2);
    assert.equal(snapshot[0].item, 'Regalo');
    assert.equal(snapshot[0].priority, 80);

    assert.equal(queue.size, 2);
});

// 14. maxSize inválido
test('maxSize inválido → error', () => {
    assert.throws(
        () => new PriorityQueue({
            maxSize: 0
        }),
        /maxSize/
    );
});

// 15. prioridad inválida
test('Prioridad inválida → error', () => {
    const queue = new PriorityQueue();

    assert.throws(
        () => queue.enqueue('A', 'abc'),
        /priority/
    );
});

console.log(
    `\n🎯 ${passed}/15 pruebas de PriorityQueue superadas correctamente.`
);