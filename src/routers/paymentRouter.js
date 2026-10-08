import express from "express";
import {
  checkoutPayment,
  getMyPayments,
  getAllPayments,
  getPaymentById,
  getPaymentByBooking,
  refundPayment,
} from "../controllers/paymentController.js";
import { barayWebhook } from "../controllers/barayWebhookController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Customer route — creates Baray payment intent and returns paymentUrl
router.post(
  "/checkout",
  protect,
  checkoutPayment
);

// Payment polling / status by booking ID
router.get("/booking/:bookingId", protect, getPaymentByBooking);

// Get current user's payment history
router.get("/my", protect, getMyPayments);

// Admin: Get all payments
router.get("/", protect, authorize("ADMIN"), getAllPayments);

// Get single payment details by ID
router.get("/:id", protect, getPaymentById);

// Admin: Process refund
router.post("/:id/refund", protect, authorize("ADMIN"), refundPayment);

// Baray webhook — called by Baray after payment succeeds (no auth token)
router.post("/webhook/baray", barayWebhook);

export default router;
