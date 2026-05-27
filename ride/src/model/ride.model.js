import mongoose from "mongoose";

const rideSchema = new mongoose.Schema({
    captain: { type: mongoose.Schema.Types.ObjectId },
    user: { type: mongoose.Schema.Types.ObjectId, required: true },
    pickup: { type: String, required: true },
    destination: { type: String, required: true },
    status: { type: String, enum: ["started", "requested", "accepted", "completed"], default: "requested" },

}, { timestamps: true });

const rideModel = mongoose.model("Ride", rideSchema);

export default rideModel;