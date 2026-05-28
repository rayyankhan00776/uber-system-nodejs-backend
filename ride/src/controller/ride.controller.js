import rideModel from "../model/ride.model.js";
import { subscribeToQueue, publishToQueue } from "../service/rabbit.js";
export async function createRide(req, res, next) {
    try {
        const { pickup, destination } = req.body;

        const newRide = new rideModel({
            user: req.user._id,
            pickup,
            destination,
        })
        await newRide.save();

        await publishToQueue("new_ride_requests", JSON.stringify(newRide));
        res.status(201).json({ message: 'Ride created successfully', data: newRide });

    } catch (error) {
        res.status(500).json({ message: 'Error creating ride', error });

    }
}

export async function acceptRide(req, res, next) {
    try {
        const { rideId } = req.params;

        if (!rideId) {
            return res.status(400).json({ message: 'rideId is required' });
        }

        const captainId = req.captain?._id;
        if (!captainId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const updatedRide = await rideModel.findOneAndUpdate(
            { _id: rideId, status: 'requested' },
            { $set: { status: 'accepted', captain: captainId } },
            { new: true }
        );

        if (!updatedRide) {
            const existingRide = await rideModel.findById(rideId);
            if (!existingRide) {
                return res.status(404).json({ message: 'Ride not found' });
            }

            if (existingRide.status === 'accepted') {
                return res.status(409).json({ message: 'Ride already accepted', data: existingRide });
            }

            return res.status(400).json({ message: `Ride cannot be accepted in status '${existingRide.status}'`, data: existingRide });
        }

        const acceptancePayload = {
            rideId: String(updatedRide._id),
            userId: String(updatedRide.user),
            captain: {
                id: String(captainId),
                name: req.captain?.name,
                email: req.captain?.email,
            },
            status: updatedRide.status,
            pickup: updatedRide.pickup,
            destination: updatedRide.destination,
            acceptedAt: updatedRide.updatedAt,
        };

        await publishToQueue("ride_accepted", acceptancePayload);

        return res.status(200).json({ message: 'Ride accepted successfully', data: updatedRide });
    } catch (error) {
        return res.status(500).json({ message: 'Error accepting ride', error });
    }
}
export default { createRide, acceptRide };