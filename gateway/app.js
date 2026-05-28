import express from 'express';
import { consoleLogger, fileLogger } from './middleware/morgan.middleware.js';

import expressProxy from 'express-http-proxy';

const app = express();

const PORT = Number(process.env.PORT ?? 3000);

const USER_SERVICE_URL = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const CAPTAIN_SERVICE_URL = process.env.CAPTAIN_SERVICE_URL ?? 'http://localhost:3002';
const RIDE_SERVICE_URL = process.env.RIDE_SERVICE_URL ?? 'http://localhost:3003';

app.use(consoleLogger);
app.use(fileLogger);
app.use('/v1/api/user', expressProxy(USER_SERVICE_URL));
app.use('/v1/api/captain', expressProxy(CAPTAIN_SERVICE_URL));
app.use('/v1/api/ride', expressProxy(RIDE_SERVICE_URL));

app.get("/", (req, res) => {
    res.send("Welcome to the API Gateway of the Uber System!");
})


if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`API Gateway is running on port ${PORT} 🟢`);
    });
}

export default app;