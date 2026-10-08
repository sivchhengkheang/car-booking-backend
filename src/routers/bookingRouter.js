import express from "express";
import {
  quoteBooking,
  createBooking,
  getMyBookings,
  getHostBookings,
  getAllBookings,
  getBookingById,
  confirmBookingPickup,
  completeBooking,
  cancelBooking,
  createBookingReview,
} from "../controllers/bookingController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Quote (Creates nothing)
router.post("/quote", protect, quoteBooking);

// Customer booking creation & history
router.post("/", protect, authorize("CUSTOMER", "ADMIN"), createBooking);
router.get("/my", protect, getMyBookings);

// Host bookings
router.get("/host", protect, authorize("HOST", "ADMIN"), getHostBookings);

// Admin all bookings
router.get("/", protect, authorize("ADMIN"), getAllBookings);

// Single booking detail (Customer owner, Host of car, Admin)
router.get("/:id", protect, getBookingById);

// Lifecycle actions
router.patch("/:id/cancel", protect, cancelBooking);
router.patch("/:id/confirm", protect, authorize("HOST", "ADMIN"), confirmBookingPickup);
router.patch("/:id/complete", protect, authorize("HOST", "ADMIN"), completeBooking);

// Customer review for completed booking
router.post("/:id/review", protect, createBookingReview);

export default router;
