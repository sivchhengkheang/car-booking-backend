import express from "express";
import { getAdminStats } from "../controllers/adminController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All admin dashboard analytics routes are restricted to ADMIN only
router.use(protect, authorize("ADMIN"));

router.get("/stats", getAdminStats);

export default router;
