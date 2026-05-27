import amqplib from "amqplib";
import config from "../config/config.js";

let connection;
let channel;
let connectPromise;

async function getChannel() {
    if (channel) return channel;

    if (!connectPromise) {
        connectPromise = (async () => {
            connection = await amqplib.connect(config.RABBIT_URI);

            connection.on("close", () => {
                connection = undefined;
                channel = undefined;
                connectPromise = undefined;
            });

            connection.on("error", (error) => {
                console.error("RabbitMQ connection error:", error);
            });

            channel = await connection.createChannel();

            channel.on("close", () => {
                channel = undefined;
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

/**
 * Publish a message to a queue.
 * @param {string} queueName
 * @param {any} message
 * @param {{ durable?: boolean, persistent?: boolean }} [options]
 */
export async function publishToQueue(queueName, message, options = {}) {
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

// Typo-friendly aliases (matching the names in your message)
export const subscribetoqueu = subscribeToQueue;
export const publshtoqueu = publishToQueue;

