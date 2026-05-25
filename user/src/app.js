import express from 'express';
import userRouter from './routes/user.routes.js';
import cookieParser from 'cookie-parser';
import { consoleLogger, fileLogger } from './middleware/morgan.middleware.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(consoleLogger);
app.use(fileLogger);

app.use('/', userRouter)

export default app;