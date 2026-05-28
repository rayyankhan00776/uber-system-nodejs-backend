import jwt from "jsonwebtoken";
import config from "../config/config.js";
import userModel from "../models/user.model.js";
import blacklistTokenModel from "../models/blacklisttoken.model.js";
export async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        const [scheme, credentials] = (authHeader ?? '').split(' ');
        const bearerToken = scheme?.toLowerCase() === 'bearer' ? credentials : undefined;

        // Prefer Authorization header to avoid cookie name collisions across services.
        const token = bearerToken || req.cookies?.user_token || req.cookies?.token;

        if (!token) {
            return res.status(401).json({ message: "No token provided" });
        }

        const isBlacklisted = await blacklistTokenModel.find({ token });

        if (isBlacklisted.length) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const decoded = jwt.verify(token, config.JWT_SECRET);

        const user = await userModel.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        req.user = user;

        next();
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}
export default authMiddleware;
