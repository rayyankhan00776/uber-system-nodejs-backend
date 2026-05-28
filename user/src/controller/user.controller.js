import userModel from '../models/user.model.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import blacklistTokenModel from '../models/blacklisttoken.model.js';
import { subscribeToQueue } from '../service/rabbit.js';

const DEFAULT_LONG_POLL_TIMEOUT_MS = 25_000;

// In-memory delivery of ride accepted events (good enough for dev).
// Keyed by rideId so user can poll by ride.
const acceptedRideByRideId = new Map();
const waitingAcceptedRideClients = [];

function deliverRideAccepted(payload) {
    const rideId = payload?.rideId ? String(payload.rideId) : undefined;
    if (!rideId) return;

    acceptedRideByRideId.set(rideId, payload);

    // Respond to any waiting long-poll clients for this ride.
    for (let i = waitingAcceptedRideClients.length - 1; i >= 0; i--) {
        const client = waitingAcceptedRideClients[i];
        if (!client || client.res.headersSent || client.res.writableEnded) {
            waitingAcceptedRideClients.splice(i, 1);
            continue;
        }

        if (client.rideId !== rideId) continue;
        if (client.userId && payload?.userId && String(payload.userId) !== client.userId) continue;

        clearTimeout(client.timeoutId);
        waitingAcceptedRideClients.splice(i, 1);
        client.res.status(200).json({ message: 'Ride accepted', data: payload });
    }
}

export async function registerUser(req, res) {
    try {
        const { name, email, password } = req.body;
        const user = await userModel.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new userModel({ name, email, password: hashedPassword });
        await newUser.save();
        const token = jwt.sign({ id: newUser._id }, config.JWT_SECRET, { expiresIn: '7d' });
        res.cookie('user_token', token);
        // Back-compat: some clients still rely on a generic cookie name.
        res.cookie('token', token);
        res.status(201).json({ message: 'User created successfully', data: { name, email }, token });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error });
    }
};

export async function loginUser(req, res) {
    try {
        const { email, password } = req.body;
        const user = await userModel.findOne({ email }).select('+password');
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const token = jwt.sign({ id: user._id }, config.JWT_SECRET, { expiresIn: '7d' });
        res.cookie('user_token', token);
        // Back-compat: some clients still rely on a generic cookie name.
        res.cookie('token', token);
        res.status(200).json({ message: 'Login successful', data: { name: user.name, email: user.email }, token });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error });
    }
};

export async function logoutUser(req, res) {
    try {
        const authHeader = req.headers.authorization;
        const [scheme, credentials] = (authHeader ?? '').split(' ');
        const bearerToken = scheme?.toLowerCase() === 'bearer' ? credentials : undefined;



        const token = bearerToken || req.cookies?.user_token || req.cookies?.token;

        if (!token) {
            return res.status(400).json({ message: 'Authorization token is required' });
        }
        if (token) {
            await blacklistTokenModel.create({ token });
        }

        res.clearCookie('user_token');
        res.clearCookie('token');
        res.status(200).json({ message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ message: 'Error logging out', error });
    }
}

export async function userProfile(req, res) {
    try {
        const user = req.user;
        res.status(200).json({ message: 'User profile', data: { name: user.name, email: user.email } });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user profile', error });
    }
}

export async function pollRideAccepted(req, res) {
    const { rideId } = req.params;
    const userId = req.user?._id ? String(req.user._id) : undefined;

    const timeoutMs = Number(req.query.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS);
    const safeTimeoutMs = Number.isFinite(timeoutMs)
        ? Math.min(Math.max(timeoutMs, 1_000), 60_000)
        : DEFAULT_LONG_POLL_TIMEOUT_MS;

    if (!rideId) {
        return res.status(400).json({ message: 'rideId is required', data: null });
    }

    const cached = acceptedRideByRideId.get(String(rideId));
    if (cached && (!cached?.userId || !userId || String(cached.userId) === userId)) {
        return res.status(200).json({ message: 'Ride accepted', data: cached });
    }

    const client = { res, timeoutId: undefined, rideId: String(rideId), userId };
    waitingAcceptedRideClients.push(client);

    const cleanup = () => {
        clearTimeout(client.timeoutId);
        const index = waitingAcceptedRideClients.indexOf(client);
        if (index !== -1) waitingAcceptedRideClients.splice(index, 1);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);

    client.timeoutId = setTimeout(() => {
        cleanup();
        if (!res.headersSent && !res.writableEnded) {
            res.status(200).json({ message: 'No ride acceptance available', data: null });
        }
    }, safeTimeoutMs);
}

void subscribeToQueue("ride_accepted", async (payload) => {
    deliverRideAccepted(payload);
}).catch((error) => {
    console.error("Failed to subscribe to 'ride_accepted':", error);
});

export default {
    registerUser,
    loginUser,
    logoutUser,
    userProfile,
    pollRideAccepted
};