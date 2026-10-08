import express from "express";
import {
  register,
  login,
  kidLogin,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  updatePassword,
} from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public routes
router.post("/register", register);
router.post("/login", login);
router.post("/kid-login", kidLogin);
router.post("/kid", kidLogin);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Protected routes
router.get("/me", protect, getMe);
router.patch("/profile", protect, updateProfile);
router.put("/profile", protect, updateProfile);
router.patch("/password", protect, updatePassword);
router.put("/password", protect, updatePassword);

export default router;
