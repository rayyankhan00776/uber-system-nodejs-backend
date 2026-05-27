import dotenv from "dotenv";
dotenv.config();

if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not defined in the environment variables");
    process.exit(1);
}

if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not defined in the environment variables");
    process.exit(1);
}

if (!process.env.BASE_URL) {
    console.error("BASE_URL is not defined in the environment variables");
    process.exit(1);
}

if (!process.env.RABBIT_URI) {
    console.error("RABBIT_URI is not defined in the environment variables");
    process.exit(1);
}

export const config = {
    PORT: process.env.PORT,
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    BASE_URL: process.env.BASE_URL,
    RABBIT_URI: process.env.RABBIT_URI,
}

export default config;