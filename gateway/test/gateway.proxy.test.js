import test from 'node:test';
import assert from 'node:assert/strict';

import express from 'express';
import supertest from 'supertest';

let userServer;
let captainServer;
let rideServer;
let gatewayApp;
let request;

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
    });
}

function baseUrl(server) {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}`;
}

test.before(async () => {
    process.env.NODE_ENV = 'test';

    const userApp = express();
    userApp.use(express.json());
    userApp.post('/register', (req, res) => {
        res.status(201).json({
            message: 'proxied user register',
            body: req.body,
        });
    });

    const captainApp = express();
    captainApp.get('/profile', (req, res) => {
        res.status(200).json({ message: 'proxied captain profile' });
    });

    const rideApp = express();
    rideApp.use(express.json());
    rideApp.post('/create-ride', (req, res) => {
        res.status(201).json({ message: 'proxied ride create', body: req.body });
    });

    userServer = await listen(userApp);
    captainServer = await listen(captainApp);
    rideServer = await listen(rideApp);

    process.env.USER_SERVICE_URL = baseUrl(userServer);
    process.env.CAPTAIN_SERVICE_URL = baseUrl(captainServer);
    process.env.RIDE_SERVICE_URL = baseUrl(rideServer);

    const { default: importedGatewayApp } = await import('../app.js');
    gatewayApp = importedGatewayApp;
    request = supertest(gatewayApp);
});

test.after(async () => {
    if (userServer) await new Promise((resolve) => userServer.close(resolve));
    if (captainServer) await new Promise((resolve) => captainServer.close(resolve));
    if (rideServer) await new Promise((resolve) => rideServer.close(resolve));
});

test('gateway: health route', async () => {
    const res = await request.get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /Welcome to the API Gateway/i);
});

test('gateway: proxies user route', async () => {
    const res = await request
        .post('/v1/api/user/register')
        .send({ name: 'Alice' });

    assert.equal(res.status, 201);
    assert.equal(res.body?.message, 'proxied user register');
    assert.equal(res.body?.body?.name, 'Alice');
});

test('gateway: proxies captain route', async () => {
    const res = await request.get('/v1/api/captain/profile');
    assert.equal(res.status, 200);
    assert.equal(res.body?.message, 'proxied captain profile');
});

test('gateway: proxies ride route', async () => {
    const res = await request
        .post('/v1/api/ride/create-ride')
        .send({ pickup: 'A', destination: 'B' });

    assert.equal(res.status, 201);
    assert.equal(res.body?.message, 'proxied ride create');
    assert.equal(res.body?.body?.pickup, 'A');
});
