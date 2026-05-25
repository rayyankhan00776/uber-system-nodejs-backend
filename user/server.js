import config from "./src/config/config.js";
import connectDB from "./src/config/db.js";
import app from "./src/app.js";
import mongoose from "mongoose";

let server;
let isShuttingDown = false;

const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`Received ${signal}. Shutting down...`);

    const forceExitTimeout = setTimeout(() => {
        console.error("Shutdown timed out. Forcing exit.");
        process.exit(1);
    }, 9_000);
    forceExitTimeout.unref();

    try {
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    } catch (error) {
        console.error("Error closing HTTP server:", error);
    }

    try {
        await mongoose.connection.close();
    } catch (error) {
        console.error("Error closing MongoDB connection:", error);
    }

    process.exit(0);
};

process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});

try {
    await connectDB();
    server = app.listen(config.PORT, () => {
        console.log(`Server is running on port ${config.PORT} 🟢`);
    });
} catch (error) {
    console.error("Error starting the server:", error);
    process.exit(1);
}