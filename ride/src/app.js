import express from 'express';
import rideRouter from './routes/ride.routes.js';
import cookieParser from 'cookie-parser';
import { consoleLogger, fileLogger } from './middleware/morgan.middleware.js';
import connect from './service/rabbit.js';

const app = express();

void connect();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(consoleLogger);
app.use(fileLogger);

app.use('/', rideRouter);

export default app;