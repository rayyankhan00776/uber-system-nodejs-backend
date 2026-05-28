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
    process.env.MONGO_URI = mongo.getUri('user_service_test');

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
        userId: String(decoded.id),
    };
}

test('user: register/login/profile/logout flow', async () => {
    const email = `alice-${Date.now()}@example.com`;
    const { token } = await registerAndLogin({
        name: 'Alice',
        email,
        password: 'pass1234',
    });

    const profileRes = await request
        .get('/profile')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.body?.data?.email, email);

    const logoutRes = await request
        .get('/logout')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(logoutRes.status, 200);

    const profileAfterLogout = await request
        .get('/profile')
        .set('Authorization', `Bearer ${token}`);

    assert.equal(profileAfterLogout.status, 401);
});

test('user: register sets cookies', async () => {
    const email = `cookie-${Date.now()}@example.com`;

    const res = await request
        .post('/register')
        .send({ name: 'Cookie User', email, password: 'pass1234' });

    assert.equal(res.status, 201);

    const cookies = res.headers?.['set-cookie'] ?? [];
    const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : String(cookies);

    assert.match(cookieStr, /\buser_token=/);
    assert.match(cookieStr, /\btoken=/);
});

test('user: register duplicate email returns 400', async () => {
    const email = `dup-${Date.now()}@example.com`;

    const first = await request
        .post('/register')
        .send({ name: 'Dup User', email, password: 'pass1234' });

    assert.equal(first.status, 201);

    const second = await request
        .post('/register')
        .send({ name: 'Dup User', email, password: 'pass1234' });

    assert.equal(second.status, 400);
    assert.equal(second.body?.message, 'User already exists');
});

test('user: login invalid credentials returns 400', async () => {
    const email = `badlogin-${Date.now()}@example.com`;

    const register = await request
        .post('/register')
        .send({ name: 'Login User', email, password: 'pass1234' });

    assert.equal(register.status, 201);

    const badLogin = await request
        .post('/login')
        .send({ email, password: 'wrong-password' });

    assert.equal(badLogin.status, 400);
    assert.equal(badLogin.body?.message, 'Invalid email or password');
});

test('user: protected endpoints require token', async () => {
    const profileRes = await request.get('/profile');
    assert.equal(profileRes.status, 401);

    const rideId = new mongoose.Types.ObjectId().toString();
    const pollRes = await request.get(`/poll-ride-accepted/${rideId}?timeoutMs=1000`);
    assert.equal(pollRes.status, 401);
});

test('user: logout without token returns 400', async () => {
    const res = await request.get('/logout');
    assert.equal(res.status, 400);
    assert.equal(res.body?.message, 'Authorization token is required');
});

test('user: poll ride accepted times out with null when no event', async () => {
    const email = `timeout-${Date.now()}@example.com`;
    const { token } = await registerAndLogin({
        name: 'Timeout User',
        email,
        password: 'pass1234',
    });

    const rideId = new mongoose.Types.ObjectId().toString();

    const pollRes = await request
        .get(`/poll-ride-accepted/${rideId}?timeoutMs=1000`)
        .set('Authorization', `Bearer ${token}`);

    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body?.message, 'No ride acceptance available');
    assert.equal(pollRes.body?.data, null);
});

test('user: poll ride accepted does not leak other user acceptance', async () => {
    const now = Date.now();

    const userA = await registerAndLogin({
        name: 'User A',
        email: `usera-${now}@example.com`,
        password: 'pass1234',
    });

    const userB = await registerAndLogin({
        name: 'User B',
        email: `userb-${now}@example.com`,
        password: 'pass1234',
    });

    const rideId = new mongoose.Types.ObjectId().toString();

    await rabbit.publishToQueue('ride_accepted', {
        rideId,
        userId: userB.userId,
        captain: {
            id: new mongoose.Types.ObjectId().toString(),
            name: 'Captain Test',
            email: 'captain@example.com',
        },
        status: 'accepted',
        pickup: 'A',
        destination: 'B',
        acceptedAt: new Date().toISOString(),
    });

    await tick();

    const pollA = await request
        .get(`/poll-ride-accepted/${rideId}?timeoutMs=1000`)
        .set('Authorization', `Bearer ${userA.token}`);

    assert.equal(pollA.status, 200);
    assert.equal(pollA.body?.message, 'No ride acceptance available');
    assert.equal(pollA.body?.data, null);

    const pollB = await request
        .get(`/poll-ride-accepted/${rideId}?timeoutMs=1000`)
        .set('Authorization', `Bearer ${userB.token}`);

    assert.equal(pollB.status, 200);
    assert.equal(pollB.body?.message, 'Ride accepted');
    assert.equal(pollB.body?.data?.rideId, rideId);
    assert.equal(String(pollB.body?.data?.userId), userB.userId);
});

test('user: poll ride accepted returns acceptance after event', async () => {
    const email = `poll-${Date.now()}@example.com`;
    const { token, userId } = await registerAndLogin({
        name: 'Poll User',
        email,
        password: 'pass1234',
    });

    const rideId = new mongoose.Types.ObjectId().toString();

    await rabbit.publishToQueue('ride_accepted', {
        rideId,
        userId,
        captain: {
            id: new mongoose.Types.ObjectId().toString(),
            name: 'Captain Test',
            email: 'captain@example.com',
        },
        status: 'accepted',
        pickup: 'Airport',
        destination: 'Downtown',
        acceptedAt: new Date().toISOString(),
    });

    // Ensure the subscribe handler ran.
    await tick();

    const pollRes = await request
        .get(`/poll-ride-accepted/${rideId}?timeoutMs=5000`)
        .set('Authorization', `Bearer ${token}`);

    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body?.message, 'Ride accepted');
    assert.equal(pollRes.body?.data?.rideId, rideId);
    assert.equal(String(pollRes.body?.data?.userId), userId);
});
