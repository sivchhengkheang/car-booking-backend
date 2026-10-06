import express from "express";
import {
  checkoutPayment,
  getMyPayments,
  getAllPayments,
  getPaymentById,
} from "../controllers/paymentController.js";
import { barayWebhook } from "../controllers/barayWebhookController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Customer route — creates Baray payment intent and returns paymentUrl
router.post(
  "/checkout",
  protect,
  authorize("CUSTOMER"),
  checkoutPayment
);

// Get current user's payment history
router.get("/my", protect, getMyPayments);

// Get all payments (Admin only)
router.get("/", protect, authorize("ADMIN"), getAllPayments);

// Get single payment details by ID
router.get("/:id", protect, getPaymentById);

// Baray webhook — called by Baray after payment succeeds (no auth token)
// NOTE: No protect/authorize middleware — Baray doesn't send a JWT
router.post("/webhook/baray", barayWebhook);

export default router;

