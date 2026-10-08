import express from "express";
import {
  updateUserRole,
  updateUserStatus,
  getAllUsers,
  getUserById,
} from "../controllers/userController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All user management routes are restricted to ADMIN only
router.use(protect, authorize("ADMIN"));

router.get("/", getAllUsers);
router.get("/:id", getUserById);
router.patch("/:id/role", updateUserRole);
router.put("/:id/role", updateUserRole);
router.patch("/:id/status", updateUserStatus);

export default router;
