import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";
import { releaseCarLock, invalidateCarCache } from "./redisService.js";

/**
 * Sweeps and deletes any booking that has been in PENDING_PAYMENT or PROVISIONAL
 * status longer than its 15-minute hold (holdExpiresAt <= now).
 *
 * This frees up the vehicle dates immediately and keeps the MongoDB database lean.
 */
export const cleanupExpiredBookings = async () => {
  try {
    const now = new Date();

    // Find any provisional/pending bookings whose hold has expired and haven't been paid
    const expiredBookings = await Booking.find({
      status: { $in: ["PENDING_PAYMENT", "PROVISIONAL"] },
      paymentStatus: { $ne: "PAID" },
      holdExpiresAt: { $lte: now },
    });

    if (!expiredBookings || expiredBookings.length === 0) {
      return 0;
    }

    console.log(
      `[BookingCleanup] Found ${expiredBookings.length} expired pending booking(s) to remove`
    );

    for (const booking of expiredBookings) {
      const carId = booking.car?._id
        ? booking.car._id.toString()
        : booking.car?.toString();

      // 1. Release Redis lock & invalidate cache so frontend immediately sees the car as free
      if (carId) {
        try {
          await releaseCarLock(carId);
          await invalidateCarCache(carId);
        } catch (lockErr) {
          console.warn(
            `[BookingCleanup] Failed to release Redis lock/cache for car ${carId}:`,
            lockErr.message
          );
        }
      }

      // 2. Clean up any incomplete Payment records tied to this expired booking
      try {
        await Payment.deleteMany({
          booking: booking._id,
          status: { $ne: "COMPLETED" },
        });
      } catch (payErr) {
        console.warn(
          `[BookingCleanup] Failed to clean up payments for booking ${booking._id}:`,
          payErr.message
        );
      }

      // 3. Delete the expired booking document from MongoDB
      await Booking.deleteOne({ _id: booking._id });
      console.log(
        `[BookingCleanup] Deleted expired booking ${booking._id} for car ${carId}`
      );
    }

    return expiredBookings.length;
  } catch (error) {
    console.error("[BookingCleanup] Error cleaning up expired bookings:", error);
    return 0;
  }
};

let cleanupInterval = null;

/**
 * Start the background worker to periodically clean up expired pending bookings.
 * @param {number} intervalMs - Frequency in milliseconds (default: 60 seconds)
 */
export const startBookingCleanupWorker = (intervalMs = 60 * 1000) => {
  // Run once immediately on startup
  cleanupExpiredBookings().catch((err) => {
    console.error("[BookingCleanup] Initial run error:", err);
  });

  // Then schedule recurring run
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  cleanupInterval = setInterval(() => {
    cleanupExpiredBookings().catch((err) => {
      console.error("[BookingCleanup] Interval run error:", err);
    });
  }, intervalMs);

  console.log(
    `[BookingCleanup] Background cleanup worker active (interval: ${intervalMs / 1000}s)`
  );
  return cleanupInterval;
};

/**
 * Stop the background worker.
 */
export const stopBookingCleanupWorker = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("[BookingCleanup] Background cleanup worker stopped");
  }
};
