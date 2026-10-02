import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

// Helper function to generate JWT token
const generateToken = (id, role) => {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET || "default_jwt_secret_key",
    { expiresIn: "7d" }
  );
};

// Helper function to structure user response without sensitive data
const formatUserResponse = (user) => {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phoneNumber: user.phoneNumber,
    driverLicense: user.driverLicense,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// @desc    Register a new user account
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, email, password, phoneNumber, role, driverLicense } = req.body;

    // Validate required fields
    if (!name || !email || !password || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields: name, email, password, and phoneNumber",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phoneNumber,
      role: role || "USER",
      driverLicense: driverLicense || {},
    });

    const token = generateToken(newUser._id, newUser.role);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: formatUserResponse(newUser),
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during registration",
    });
  }
};

// @desc    Authenticate user & get token (Login)
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email & password presence
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // Check for user and include password field
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Match password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during login",
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// @desc    Update user profile details
// @route   PUT /api/auth/profile
// @access  Private
export const updateProfile = async (req, res) => {
  try {
    const { name, phoneNumber, driverLicense } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (name) user.name = name;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (driverLicense) {
      user.driverLicense = {
        ...user.driverLicense,
        ...driverLicense,
      };
    }

    const updatedUser = await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: formatUserResponse(updatedUser),
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during profile update",
    });
  }
};

// @desc    Update user password
// @route   PUT /api/auth/password
// @access  Private
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide currentPassword and newPassword",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash and update to new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update Password Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during password update",
    });
  }
};
