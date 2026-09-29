/**
 * The functions an {@link UpdateQueue} calls for each update.
 */
export type UpdateQueueHandlers<T, R> = {
    /**
     * Sends an update. The next one is not sent before the returned promise settles.
     */
    send: (update: T) => Promise<R>;
    /**
     * Called with the result of an update, once it is no longer being sent.
     */
    onResult: (update: T, result: R) => void;
    /**
     * Called when sending an update, or handling its result, failed.
     */
    onError: (update: T, error: unknown) => void;
};

/**
 * Sends updates one at a time, in the order they were queued.
 * An update queued while others are waiting can be merged into the last one.
 */
export class UpdateQueue<T, R> {
    private readonly _handlers: UpdateQueueHandlers<T, R>;
    private _waiting: T[] = [];
    private _sending = false;
    private _idle: Promise<void> | undefined;
    private _resolveIdle: (() => void) | undefined;

    constructor(handlers: UpdateQueueHandlers<T, R>) {
        this._handlers = handlers;
    }

    /**
     * Whether no update is being sent or waiting to be.
     */
    get idle(): boolean {
        return !this._sending && this._waiting.length === 0;
    }

    /**
     * Queues an update without sending it.
     * @param merge - Merges the update into the last waiting one, or returns `undefined` to queue it after.
     */
    enqueue(update: T, merge?: (last: T, update: T) => T | undefined): void {
        const last = this._waiting.length ? this._waiting[this._waiting.length - 1] : undefined;
        const merged = last !== undefined && merge ? merge(last, update) : undefined;
        if (merged !== undefined) {
            this._waiting[this._waiting.length - 1] = merged;
        } else {
            this._waiting.push(update);
        }
    }

    /**
     * Drops the waiting updates and queues this one instead.
     */
    replace(update: T): void {
        this._waiting = [update];
    }

    /**
     * Sends the waiting updates.
     * @returns a promise that resolves once no update is being sent or waiting to be.
     */
    flush(): Promise<void> {
        if (this.idle) return Promise.resolve();
        this._idle ??= new Promise((resolve) => { this._resolveIdle = resolve; });
        this._next();
        return this._idle;
    }

    private _next(): void {
        if (this._sending) return;
        const update = this._waiting.shift();
        if (update === undefined) {
            const resolve = this._resolveIdle;
            this._idle = undefined;
            this._resolveIdle = undefined;
            resolve?.();
            return;
        }
        this._sending = true;
        this._handlers.send(update)
            .then((result) => {
                this._sending = false;
                this._handlers.onResult(update, result);
            })
            .catch((error: unknown) => {
                this._sending = false;
                this._handlers.onError(update, error);
            })
            .finally(() => this._next());
    }
}
