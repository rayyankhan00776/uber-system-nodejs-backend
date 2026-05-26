import jwt from "jsonwebtoken";
import config from "../config/config.js";
import captainModel from "../models/captain.model.js";
import blacklistTokenModel from "../models/blacklisttoken.model.js";
export async function authMiddleware(req, res, next) {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({ message: "No token provided" });
        }

        const isBlacklisted = await blacklistTokenModel.find({ token });

        if (isBlacklisted.length) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const decoded = jwt.verify(token, config.JWT_SECRET);

        const captain = await captainModel.findById(decoded.id);
        if (!captain) {
            return res.status(401).json({ message: "Captain not found" });
        }

        req.captain = captain;

        next();
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}
export default authMiddleware;
