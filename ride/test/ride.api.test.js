import test from 'node:test';
import assert from 'node:assert/strict';

import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

const JWT_SECRET = 'test-jwt-secret';

let mongo;
let stubServer;
let app;
let request;
let rabbit;

const stubStats = {
    userProfileCalls: 0,
    captainProfileCalls: 0,
    lastUserAuth: undefined,
    lastCaptainAuth: undefined,
};

function resetStubStats() {
    stubStats.userProfileCalls = 0;
    stubStats.captainProfileCalls = 0;
    stubStats.lastUserAuth = undefined;
    stubStats.lastCaptainAuth = undefined;
}

async function startAuthStubServer() {
    const stub = express();

    stub.get('/v1/api/user/profile', (req, res) => {
        stubStats.userProfileCalls += 1;
        stubStats.lastUserAuth = req.headers.authorization;

        const auth = req.headers.authorization || '';
        const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';

        try {
            jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({ message: 'Invalid token' });
        }

        return res.status(200).json({
            message: 'User profile',
            data: {
                name: 'Test User',
                email: 'user@example.com',
            },
        });
    });

    stub.get('/v1/api/captain/profile', (req, res) => {
        stubStats.captainProfileCalls += 1;
        stubStats.lastCaptainAuth = req.headers.authorization;

        const auth = req.headers.authorization || '';
        const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';

        try {
            jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({ message: 'Invalid token' });
        }

        return res.status(200).json({
            message: 'captain profile',
            data: {
                name: 'Test Captain',
                email: 'captain@example.com',
                isAvailable: true,
            },
        });
    });

    return await new Promise((resolve, reject) => {
        const server = stub.listen(0, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
    });
}

test.before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RABBIT_DRIVER = 'memory';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.RABBIT_URI = 'memory://';

    stubServer = await startAuthStubServer();
    const addr = stubServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.BASE_URL = `http://127.0.0.1:${port}`;

    mongo = await MongoMemoryServer.create({
        instance: {
            launchTimeout: 60_000,
        },
    });
    process.env.MONGO_URI = mongo.getUri('ride_service_test');

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
    if (stubServer) await new Promise((resolve) => stubServer.close(resolve));
    if (mongo) await mongo.stop();
});

test('ride: create-ride publishes new_ride_requests', async () => {
    resetStubStats();

    const userId = new mongoose.Types.ObjectId();
    const userToken = jwt.sign({ id: userId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const published = [];
    const consumer = await rabbit.subscribeToQueue('new_ride_requests', async (payload) => {
        published.push(payload);
    });

    const res = await request
        .post('/create-ride')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ pickup: 'Airport', destination: 'Downtown' });

    assert.equal(res.status, 201);
    assert.equal(res.body?.message, 'Ride created successfully');
    assert.ok(res.body?.data?._id);
    assert.equal(String(res.body?.data?.user), userId.toString());
    assert.equal(res.body?.data?.pickup, 'Airport');
    assert.equal(res.body?.data?.destination, 'Downtown');

    // The publish happens inside the request handler.
    assert.equal(published.length, 1);
    assert.equal(String(published[0]?._id), String(res.body.data._id));

    assert.equal(stubStats.userProfileCalls, 1);
    assert.match(String(stubStats.lastUserAuth ?? ''), /^Bearer\s+/i);

    if (consumer?.cancel) await consumer.cancel();
});

test('ride: create-ride requires user auth', async () => {
    resetStubStats();

    const noToken = await request
        .post('/create-ride')
        .send({ pickup: 'A', destination: 'B' });

    assert.equal(noToken.status, 401);
    assert.equal(noToken.body?.message, 'No token provided');
    assert.equal(stubStats.userProfileCalls, 0);

    const invalidToken = await request
        .post('/create-ride')
        .set('Authorization', 'Bearer invalid-token')
        .send({ pickup: 'A', destination: 'B' });

    assert.equal(invalidToken.status, 401);
    assert.equal(invalidToken.body?.message, 'Invalid token');
    assert.equal(stubStats.userProfileCalls, 0);
});

test('ride: accept-ride publishes ride_accepted and updates status', async () => {
    resetStubStats();

    const userId = new mongoose.Types.ObjectId();
    const userToken = jwt.sign({ id: userId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const createRes = await request
        .post('/create-ride')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ pickup: 'Station', destination: 'Mall' });

    assert.equal(createRes.status, 201);
    const rideId = createRes.body?.data?._id;
    assert.ok(rideId);

    const captainId = new mongoose.Types.ObjectId();
    const captainToken = jwt.sign({ id: captainId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const acceptedEvents = [];
    const consumer = await rabbit.subscribeToQueue('ride_accepted', async (payload) => {
        acceptedEvents.push(payload);
    });

    const acceptRes = await request
        .patch(`/accept-ride/${rideId}`)
        .set('Authorization', `Bearer ${captainToken}`);

    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.body?.message, 'Ride accepted successfully');
    assert.equal(acceptRes.body?.data?.status, 'accepted');
    assert.equal(String(acceptRes.body?.data?.captain), captainId.toString());

    assert.equal(acceptedEvents.length, 1);
    assert.equal(String(acceptedEvents[0]?.rideId), String(rideId));
    assert.equal(String(acceptedEvents[0]?.userId), userId.toString());
    assert.equal(String(acceptedEvents[0]?.captain?.id), captainId.toString());
    assert.equal(acceptedEvents[0]?.status, 'accepted');

    assert.equal(stubStats.captainProfileCalls, 1);
    assert.match(String(stubStats.lastCaptainAuth ?? ''), /^Bearer\s+/i);

    if (consumer?.cancel) await consumer.cancel();
});

test('ride: accept-ride requires captain auth', async () => {
    resetStubStats();

    const rideId = new mongoose.Types.ObjectId().toString();

    const noToken = await request
        .patch(`/accept-ride/${rideId}`);

    assert.equal(noToken.status, 401);
    assert.equal(noToken.body?.message, 'No token provided');
    assert.equal(stubStats.captainProfileCalls, 0);

    const invalidToken = await request
        .patch(`/accept-ride/${rideId}`)
        .set('Authorization', 'Bearer invalid-token');

    assert.equal(invalidToken.status, 401);
    assert.equal(invalidToken.body?.message, 'Invalid token');
    assert.equal(stubStats.captainProfileCalls, 0);
});

test('ride: accept-ride returns 404 for missing ride', async () => {
    resetStubStats();

    const captainId = new mongoose.Types.ObjectId();
    const captainToken = jwt.sign({ id: captainId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const missingRideId = new mongoose.Types.ObjectId().toString();
    const res = await request
        .patch(`/accept-ride/${missingRideId}`)
        .set('Authorization', `Bearer ${captainToken}`);

    assert.equal(res.status, 404);
    assert.equal(res.body?.message, 'Ride not found');
    assert.equal(stubStats.captainProfileCalls, 1);
});

test('ride: accept-ride returns 409 when already accepted', async () => {
    resetStubStats();

    const userId = new mongoose.Types.ObjectId();
    const userToken = jwt.sign({ id: userId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const createRes = await request
        .post('/create-ride')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ pickup: 'X', destination: 'Y' });

    assert.equal(createRes.status, 201);
    const rideId = createRes.body?.data?._id;
    assert.ok(rideId);

    const captainA = new mongoose.Types.ObjectId();
    const captainAToken = jwt.sign({ id: captainA.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const captainB = new mongoose.Types.ObjectId();
    const captainBToken = jwt.sign({ id: captainB.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const acceptedEvents = [];
    const consumer = await rabbit.subscribeToQueue('ride_accepted', async (payload) => {
        acceptedEvents.push(payload);
    });

    const firstAccept = await request
        .patch(`/accept-ride/${rideId}`)
        .set('Authorization', `Bearer ${captainAToken}`);

    assert.equal(firstAccept.status, 200);

    const secondAccept = await request
        .patch(`/accept-ride/${rideId}`)
        .set('Authorization', `Bearer ${captainBToken}`);

    assert.equal(secondAccept.status, 409);
    assert.equal(secondAccept.body?.message, 'Ride already accepted');

    // Only the first accept should publish an event.
    assert.equal(acceptedEvents.length, 1);

    if (consumer?.cancel) await consumer.cancel();
});

test('ride: accept-ride returns 400 when ride is not in requested status', async () => {
    resetStubStats();

    const { default: rideModel } = await import('../src/model/ride.model.js');

    const userId = new mongoose.Types.ObjectId();
    const userToken = jwt.sign({ id: userId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const createRes = await request
        .post('/create-ride')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ pickup: 'P', destination: 'Q' });

    assert.equal(createRes.status, 201);
    const rideId = createRes.body?.data?._id;
    assert.ok(rideId);

    await rideModel.findByIdAndUpdate(rideId, { $set: { status: 'completed' } });

    const captainId = new mongoose.Types.ObjectId();
    const captainToken = jwt.sign({ id: captainId.toString() }, JWT_SECRET, { expiresIn: '7d' });

    const acceptedEvents = [];
    const consumer = await rabbit.subscribeToQueue('ride_accepted', async (payload) => {
        acceptedEvents.push(payload);
    });

    const res = await request
        .patch(`/accept-ride/${rideId}`)
        .set('Authorization', `Bearer ${captainToken}`);

    assert.equal(res.status, 400);
    assert.match(String(res.body?.message ?? ''), /Ride cannot be accepted in status 'completed'/);
    assert.equal(acceptedEvents.length, 0);

    if (consumer?.cancel) await consumer.cancel();
});
