import express from "express";
import {
  createBooking,
  getMyBookings,
  confirmBookingPickup,
} from "../controllers/bookingController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Customer routes
router.post("/", protect, authorize("CUSTOMER"), createBooking);
router.get("/my", protect, authorize("CUSTOMER"), getMyBookings);

// Host / Admin route for pickup verification & rental activation
router.patch(
  "/:id/confirm",
  protect,
  authorize("HOST", "ADMIN"),
  confirmBookingPickup
);

export default router;
