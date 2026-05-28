import amqplib from "amqplib";
import config from "../config/config.js";
import { EventEmitter } from "events";

const USE_MEMORY_DRIVER =
    process.env.RABBIT_DRIVER === "memory" ||
    process.env.NODE_ENV === "test";

const MEMORY_BUS = (() => {
    if (!USE_MEMORY_DRIVER) return undefined;
    if (globalThis.__UBER_SYSTEM_MEMORY_BUS__) return globalThis.__UBER_SYSTEM_MEMORY_BUS__;

    const bus = {
        emitter: new EventEmitter(),
    };

    // Avoid MaxListenersExceededWarning in test runs.
    bus.emitter.setMaxListeners(0);

    globalThis.__UBER_SYSTEM_MEMORY_BUS__ = bus;
    return bus;
})();

let connection;
let channel;
let connectPromise;
let hasLoggedConnected = false;

async function getChannel() {
    if (channel) return channel;

    if (!connectPromise) {
        connectPromise = (async () => {
            connection = await amqplib.connect(config.RABBIT_URI);

            connection.on("close", () => {
                connection = undefined;
                channel = undefined;
                connectPromise = undefined;
                hasLoggedConnected = false;
            });

            connection.on("error", (error) => {
                console.error("RabbitMQ connection error:", error);
            });

            channel = await connection.createChannel();

            channel.on("close", () => {
                channel = undefined;
                hasLoggedConnected = false;
            });

            channel.on("error", (error) => {
                console.error("RabbitMQ channel error:", error);
            });

            return channel;
        })().finally(() => {
            connectPromise = undefined;
        });
    }

    return connectPromise;
}

function toBuffer(message) {
    if (Buffer.isBuffer(message)) return message;
    if (typeof message === "string") return Buffer.from(message);
    return Buffer.from(JSON.stringify(message));
}

function tryParseJSON(value) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

// Default export is a function so you can do: `import connect from './service/rabbit.js'; connect();`
export async function connect() {
    if (USE_MEMORY_DRIVER) {
        if (!hasLoggedConnected) {
            console.log("[RabbitMQ] Using in-memory driver at captain service");
            hasLoggedConnected = true;
        }
        return true;
    }

    try {
        await getChannel();

        if (!hasLoggedConnected) {
            console.log("[RabbitMQ] Connected at captain service");
            hasLoggedConnected = true;
        }

        return true;
    } catch (error) {
        console.error("[RabbitMQ] Connection failed:", error);
        return false;
    }
}

/**
 * Publish a message to a queue.
 * @param {string} queueName
 * @param {any} message
 * @param {{ durable?: boolean, persistent?: boolean }} [options]
 */
export async function publishToQueue(queueName, message, options = {}) {
    if (USE_MEMORY_DRIVER) {
        const emitter = MEMORY_BUS?.emitter;
        const payload = typeof message === "string" ? tryParseJSON(message) : message;
        emitter?.emit(queueName, payload);
        return true;
    }

    const { durable = true, persistent = true } = options;
    const ch = await getChannel();

    await ch.assertQueue(queueName, { durable });

    const ok = ch.sendToQueue(queueName, toBuffer(message), {
        persistent,
        contentType: "application/json",
    });

    return ok;
}

/**
 * Subscribe (consume) messages from a queue.
 * Handler receives (payload, rawMsg).
 * @param {string} queueName
 * @param {(payload: any, rawMsg: import('amqplib').ConsumeMessage) => (void|Promise<void>)} handler
 * @param {{ durable?: boolean, prefetch?: number, requeueOnError?: boolean }} [options]
 */
export async function subscribeToQueue(queueName, handler, options = {}) {
    if (USE_MEMORY_DRIVER) {
        const { requeueOnError = false } = options;
        const emitter = MEMORY_BUS?.emitter;

        const listener = async (payload) => {
            try {
                await handler(payload, undefined);
            } catch (error) {
                console.error(`Error processing in-memory message from queue '${queueName}':`, error);
                if (requeueOnError) {
                    setImmediate(() => emitter?.emit(queueName, payload));
                }
            }
        };

        emitter?.on(queueName, listener);

        return {
            consumerTag: `memory:${queueName}`,
            cancel: async () => emitter?.off(queueName, listener),
        };
    }

    const { durable = true, prefetch = 1, requeueOnError = false } = options;
    const ch = await getChannel();

    await ch.assertQueue(queueName, { durable });
    await ch.prefetch(prefetch);

    const consumer = await ch.consume(
        queueName,
        async (msg) => {
            if (!msg) return;
            try {
                const payload = tryParseJSON(msg.content.toString("utf8"));
                await handler(payload, msg);
                ch.ack(msg);
            } catch (error) {
                console.error(`Error processing message from queue '${queueName}':`, error);
                ch.nack(msg, false, requeueOnError);
            }
        },
        { noAck: false }
    );

    return consumer;
}

// Typo-friendly aliases (matching your earlier naming)
export const subscribetoqueu = subscribeToQueue;
export const publshtoqueu = publishToQueue;

export default connect;