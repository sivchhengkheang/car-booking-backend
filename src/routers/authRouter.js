import express from "express";
import {
  register,
  login,
  getMe,
  updateProfile,
  updatePassword,
} from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public routes
router.post("/register", register);
router.post("/login", login);

// Protected routes
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.put("/password", protect, updatePassword);

export default router;
