import express from 'express';
import { consoleLogger, fileLogger } from './middleware/morgan.middleware.js';

import expressProxy from 'express-http-proxy';

const app = express();

app.use(consoleLogger);
app.use(fileLogger);
app.use('/v1/api/user', expressProxy('http://localhost:3001'));
app.use('/v1/api/captain', expressProxy('http://localhost:3002'));
app.use('/v1/api/ride', expressProxy('http://localhost:3003'));

app.get("/", (req, res) => {
    res.send("Welcome to the API Gateway of the Uber System!");
})


app.listen(3000, () => {
    console.log('API Gateway is running on port 3000 🟢');
})