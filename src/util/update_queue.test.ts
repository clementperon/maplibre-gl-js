import {describe, test, expect, vi} from 'vitest';
import {UpdateQueue} from './update_queue.ts';
import {sleep} from './test/util.ts';

function createQueue() {
    const sent: string[] = [];
    const answers: Array<() => void> = [];
    const results: string[] = [];
    const errors: unknown[] = [];
    const queue = new UpdateQueue<string, string>({
        send: (update) => {
            sent.push(update);
            return new Promise((resolve) => answers.push(() => resolve(update)));
        },
        onResult: (_update, result) => { results.push(result); },
        onError: (_update, error) => { errors.push(error); }
    });
    const answer = async () => {
        answers.shift()();
        await sleep(0);
    };
    return {queue, sent, results, errors, answer};
}

describe('UpdateQueue', () => {
    test('sends one update at a time, in order', async () => {
        const {queue, sent, results, answer} = createQueue();
        queue.enqueue('a');
        queue.enqueue('b');
        queue.flush();
        expect(sent).toEqual(['a']);

        await answer();
        expect(sent).toEqual(['a', 'b']);
        expect(results).toEqual(['a']);

        await answer();
        expect(results).toEqual(['a', 'b']);
        expect(queue.idle).toBe(true);
    });

    test('does not send before flush', () => {
        const {queue, sent} = createQueue();
        queue.enqueue('a');
        expect(sent).toEqual([]);
        expect(queue.idle).toBe(false);
    });

    test('merges an update into the last waiting one', async () => {
        const {queue, sent, answer} = createQueue();
        const merge = (last: string, update: string) => last + update;
        queue.enqueue('a');
        queue.flush();
        queue.enqueue('b', merge);
        queue.enqueue('c', merge);

        await answer();
        expect(sent).toEqual(['a', 'bc']);
    });

    test('replaces the waiting updates', async () => {
        const {queue, sent, answer} = createQueue();
        queue.enqueue('a');
        queue.flush();
        queue.enqueue('b');
        queue.replace('c');

        await answer();
        expect(sent).toEqual(['a', 'c']);
    });

    test('resolves flush once every update is done', async () => {
        const {queue, answer} = createQueue();
        const done = vi.fn();
        queue.enqueue('a');
        queue.flush().then(done);
        queue.enqueue('b');
        queue.flush().then(done);

        await answer();
        expect(done).not.toHaveBeenCalled();
        await answer();
        expect(done).toHaveBeenCalledTimes(2);
    });

    test('is idle when the result of the last update is handled', async () => {
        const idle: boolean[] = [];
        const queue = new UpdateQueue<string, void>({
            send: () => Promise.resolve(),
            onResult: () => { idle.push(queue.idle); },
            onError: () => {}
        });
        queue.enqueue('a');
        await queue.flush();
        expect(idle).toEqual([true]);
    });

    test('passes a failed update to onError and sends the next one', async () => {
        const errors: unknown[] = [];
        const sent: string[] = [];
        const queue = new UpdateQueue<string, void>({
            send: (update) => {
                sent.push(update);
                return update === 'a' ? Promise.reject(new Error('failed')) : Promise.resolve();
            },
            onResult: () => {},
            onError: (_update, error) => { errors.push(error); }
        });
        queue.enqueue('a');
        queue.enqueue('b');
        await queue.flush();
        expect(sent).toEqual(['a', 'b']);
        expect(errors).toHaveLength(1);
    });

});
