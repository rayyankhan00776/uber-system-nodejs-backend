import test from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

const JWT_SECRET = 'test-jwt-secret';

let mongo;
let app;
let request;
let rabbit;

async function tick() {
    await new Promise((resolve) => setImmediate(resolve));
}

test.before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RABBIT_DRIVER = 'memory';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.RABBIT_URI = 'memory://';

    mongo = await MongoMemoryServer.create({
        instance: {
            launchTimeout: 60_000,
        },
    });
    process.env.MONGO_URI = mongo.getUri('captain_service_test');

    const [{ default: importedApp }, importedRabbit] = await Promise.all([
        import('../src/app.js'),
        import('../src/service/rabbit.js'),
    ]);

    app = importedApp;
    rabbit = importedRabbit;

    await mongoose.connect(process.env.MONGO_URI);
    request = supertest(app);
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});

async function registerAndLogin({ name, email, password }) {
    const registerRes = await request
        .post('/register')
        .send({ name, email, password });

    assert.equal(registerRes.status, 201);
    assert.ok(registerRes.body.token);

    const loginRes = await request
        .post('/login')
        .send({ email, password });

    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.body.token);

    const token = loginRes.body.token;
    const decoded = jwt.verify(token, JWT_SECRET);

    return {
        token,
        captainId: String(decoded.id),
    };
}

test('captain: register/login/profile/toggle/logout flow', async () => {
    const email = `captain-${Date.now()}@example.com`;
    const { token } = await registerAndLogin({
        name: 'Captain',
        email,
        password: 'pass1234',
    });

    const profileRes = await request
        .get('/profile')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.body?.data?.email, email);
    assert.equal(profileRes.body?.data?.isAvailable, false);

    const toggleRes = await request
        .patch('/toggle-availability')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(toggleRes.status, 200);
    assert.equal(typeof toggleRes.body?.data?.isAvailable, 'boolean');

    const toggleRes2 = await request
        .patch('/toggle-availability')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(toggleRes2.status, 200);
    assert.notEqual(toggleRes2.body?.data?.isAvailable, toggleRes.body?.data?.isAvailable);

    const logoutRes = await request
        .get('/logout')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(logoutRes.status, 200);

    const profileAfterLogout = await request
        .get('/profile')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(profileAfterLogout.status, 401);
});

test('captain: register sets cookies', async () => {
    const email = `cookie-captain-${Date.now()}@example.com`;

    const res = await request
        .post('/register')
        .send({ name: 'Cookie Captain', email, password: 'pass1234' });

    assert.equal(res.status, 201);

    const cookies = res.headers?.['set-cookie'] ?? [];
    const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : String(cookies);

    assert.match(cookieStr, /\bcaptain_token=/);
    assert.match(cookieStr, /\btoken=/);
});

test('captain: register duplicate email returns 400', async () => {
    const email = `dup-captain-${Date.now()}@example.com`;

    const first = await request
        .post('/register')
        .send({ name: 'Dup Captain', email, password: 'pass1234' });

    assert.equal(first.status, 201);

    const second = await request
        .post('/register')
        .send({ name: 'Dup Captain', email, password: 'pass1234' });

    assert.equal(second.status, 400);
    assert.equal(second.body?.message, 'captain already exists');
});

test('captain: login invalid credentials returns 400', async () => {
    const email = `badlogin-captain-${Date.now()}@example.com`;

    const register = await request
        .post('/register')
        .send({ name: 'Login Captain', email, password: 'pass1234' });

    assert.equal(register.status, 201);

    const badLogin = await request
        .post('/login')
        .send({ email, password: 'wrong-password' });

    assert.equal(badLogin.status, 400);
    assert.equal(badLogin.body?.message, 'Invalid email or password');
});

test('captain: protected endpoints require token', async () => {
    const profileRes = await request.get('/profile');
    assert.equal(profileRes.status, 401);

    const toggleRes = await request.patch('/toggle-availability');
    assert.equal(toggleRes.status, 401);

    const pollRes = await request.get('/poll-new-ride?timeoutMs=1000');
    assert.equal(pollRes.status, 401);
});

test('captain: logout without token returns 400', async () => {
    const res = await request.get('/logout');
    assert.equal(res.status, 400);
    assert.equal(res.body?.message, 'unauthorized: token is required');
});

test('captain: poll new ride times out with null when no event', async () => {
    const email = `timeout-captain-${Date.now()}@example.com`;
    const { token } = await registerAndLogin({
        name: 'Timeout Captain',
        email,
        password: 'pass1234',
    });

    const pollRes = await request
        .get('/poll-new-ride?timeoutMs=1000')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body?.message, 'No new ride available');
    assert.equal(pollRes.body?.data, null);
});

test('captain: poll new ride delivers to waiting long-poll client', async () => {
    const email = `waiting-captain-${Date.now()}@example.com`;
    const { token } = await registerAndLogin({
        name: 'Waiting Captain',
        email,
        password: 'pass1234',
    });

    const ridePayload = {
        _id: new mongoose.Types.ObjectId().toString(),
        user: new mongoose.Types.ObjectId().toString(),
        pickup: 'Station',
        destination: 'Mall',
        status: 'requested',
    };

    const pollPromise = request
        .get('/poll-new-ride?timeoutMs=5000')
        .set('Authorization', `Bearer ${token}`);

    // Give Express a moment to attach the long-poll client.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await rabbit.publishToQueue('new_ride_requests', ridePayload);
    await tick();

    const pollRes = await pollPromise;

    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body?.message, 'New ride available');
    assert.equal(pollRes.body?.data?._id, ridePayload._id);
});

test('captain: poll new ride returns payload after event', async () => {
    const email = `poll-captain-${Date.now()}@example.com`;
    const { token } = await registerAndLogin({
        name: 'Captain Poll',
        email,
        password: 'pass1234',
    });

    const ridePayload = {
        _id: new mongoose.Types.ObjectId().toString(),
        user: new mongoose.Types.ObjectId().toString(),
        pickup: 'Airport',
        destination: 'Downtown',
        status: 'requested',
    };

    await rabbit.publishToQueue('new_ride_requests', ridePayload);
    await tick();

    const pollRes = await request
        .get('/poll-new-ride?timeoutMs=5000')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body?.message, 'New ride available');
    assert.equal(pollRes.body?.data?._id, ridePayload._id);
});
