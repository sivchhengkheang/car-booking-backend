import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/User.js";
import { verifyKidOAuthToken } from "../middlewares/authMiddleware.js";

// Helper function to generate Access Token (short-lived)
const generateAccessToken = (id, role) => {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET || "default_jwt_secret_key",
    { expiresIn: "15m" }
  );
};

// Helper function to generate Refresh Token (longer-lived)
const generateRefreshToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "default_jwt_secret_key",
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
    status: user.status || "ACTIVE",
    sub: user.sub || null,
    kid: user.kid || null,
    walletAddress: user.walletAddress || null,
    phoneNumber: user.phoneNumber,
    driverLicense: user.driverLicense,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// @desc    Register a new user account
// @route   POST /api/v1/auth/register
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

    // Security Check: Block ADMIN registration
    if (role && String(role).toUpperCase() === "ADMIN") {
      return res.status(400).json({
        success: false,
        error: {
          code: "ADMIN_REGISTRATION_FORBIDDEN",
          message: "Cannot register as ADMIN directly. Admin role must be assigned by an existing administrator.",
        },
      });
    }

    const assignedRole = role && String(role).toUpperCase() === "HOST" ? "HOST" : "CUSTOMER";

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
      role: assignedRole,
      status: "ACTIVE",
      driverLicense: driverLicense || {},
    });

    const accessToken = generateAccessToken(newUser._id, newUser.role);
    const refreshToken = generateRefreshToken(newUser._id);

    // Save refresh token
    newUser.refreshToken = refreshToken;
    await newUser.save();

    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      accessToken,
      refreshToken,
      token: accessToken, // backwards compatibility
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

// @desc    Authenticate user & get tokens (Login)
// @route   POST /api/v1/auth/login
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

    // Check if account is suspended
    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_SUSPENDED",
          message: "Your account has been suspended. Please contact customer support.",
        },
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

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      token: accessToken, // backwards compatibility
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

// @desc    Refresh access token using refresh token
// @route   POST /api/v1/auth/refresh
// @access  Public
export const refresh = async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        code: "NO_REFRESH_TOKEN",
        message: "Please provide a refreshToken in request body or cookie",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "default_jwt_secret_key"
      );
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: "REFRESH_TOKEN_EXPIRED",
        message: "Refresh token failed or expired",
      });
    }

    const user = await User.findById(decoded.id).select("+refreshToken");
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        code: "INVALID_REFRESH_TOKEN",
        message: "Invalid or expired refresh token",
      });
    }

    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_SUSPENDED",
        message: "Account suspended",
      });
    }

    const newAccessToken = generateAccessToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    user.refreshToken = newRefreshToken;
    await user.save();

    res.cookie("token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      token: newAccessToken,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Refresh Token Error:", error.message);
    return res.status(401).json({
      success: false,
      code: "REFRESH_FAILED",
      message: "Refresh token failed or expired",
    });
  }
};

// @desc    Revoke refresh token & Logout
// @route   POST /api/v1/auth/logout
// @access  Public / Auth
export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const user = await User.findOne({ refreshToken });
      if (user) {
        user.refreshToken = undefined;
        await user.save();
      }
    } else if (req.user) {
      const user = await User.findById(req.user._id);
      if (user) {
        user.refreshToken = undefined;
        await user.save();
      }
    }

    res.clearCookie("token");

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error during logout",
    });
  }
};

// @desc    Request password reset token
// @route   POST /api/v1/auth/forgot-password
// @access  Public
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email address",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't leak user existence
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, password reset instructions have been sent.",
      });
    }

    // Generate random reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash token and set expiry (1 hour)
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpire = Date.now() + 60 * 60 * 1000;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset token generated",
      resetToken, // Returned for dev/testing integration
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error during forgot password",
    });
  }
};

// @desc    Reset password using reset token
// @route   POST /api/v1/auth/reset-password
// @access  Public
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide reset token and newPassword",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired password reset token",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You can now log in.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error during password reset",
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/v1/auth/me
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
// @route   PATCH /api/v1/auth/profile or PUT /api/v1/auth/profile
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
// @route   PATCH /api/v1/auth/password or PUT /api/v1/auth/password
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

// ---------------------------------------------------------------------------
// @desc    Authenticate or register user via KID (KOOMPI ID)
// @route   POST /api/v1/auth/kid-login
// @access  Public
// ---------------------------------------------------------------------------
export const kidLogin = async (req, res) => {
  try {
    const {
      accessToken,
      sub: providedSub,
      kid,
      name,
      email,
      phoneNumber,
      walletAddress,
      merged_from,
    } = req.body;

    let kidProfile = null;

    // 1. If accessToken provided, verify with KID UserInfo endpoint
    if (accessToken) {
      kidProfile = await verifyKidOAuthToken(accessToken);
    }

    const sub = kidProfile?.sub || providedSub;

    if (!sub) {
      return res.status(400).json({
        success: false,
        message: "Missing KID subject identifier (sub)",
      });
    }

    const finalKid = kidProfile?.kid || kid || "";
    const finalName =
      kidProfile?.name ||
      name ||
      (finalKid ? `KID User #${finalKid}` : "KID Customer");
    const finalEmail = (
      kidProfile?.email ||
      email ||
      `${sub}@kid.user`
    ).toLowerCase();
    const finalPhone =
      kidProfile?.phone || kidProfile?.phoneNumber || phoneNumber || "";
    const finalWallet = kidProfile?.wallet?.address || walletAddress || "";

    // 2. Handle merged accounts per KID Rule 4:
    const mergedList = kidProfile?.merged_from || merged_from;
    if (Array.isArray(mergedList) && mergedList.length > 0) {
      for (const closed of mergedList) {
        if (closed?.sub) {
          console.log(
            `[KID] Merging closed sub: ${closed.sub} -> survivor: ${sub}`
          );
        }
      }
    }

    // 3. Find user by sub first (Rule 3: key users by sub)
    let user = await User.findOne({ sub });

    // Fallback: Check by email to link accounts created prior to KID
    if (!user && finalEmail) {
      user = await User.findOne({ email: finalEmail });
      if (user) {
        user.sub = sub;
        if (finalKid) user.kid = finalKid;
        if (finalWallet) user.walletAddress = finalWallet;
        await user.save();
      }
    }

    // 4. Create if new user
    if (!user) {
      user = await User.create({
        sub,
        kid: finalKid,
        name: finalName,
        email: finalEmail,
        phoneNumber: finalPhone,
        walletAddress: finalWallet,
        role: "CUSTOMER",
        status: "ACTIVE",
      });
    } else {
      // User exists: update latest KID profile details
      let hasChanges = false;
      if (finalKid && user.kid !== finalKid) {
        user.kid = finalKid;
        hasChanges = true;
      }
      if (finalWallet && user.walletAddress !== finalWallet) {
        user.walletAddress = finalWallet;
        hasChanges = true;
      }
      if (finalName && user.name !== finalName && !user.name.startsWith("Host")) {
        user.name = finalName;
        hasChanges = true;
      }
      if (hasChanges) {
        await user.save();
      }
    }

    // Check account status
    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_SUSPENDED",
          message: "Your account has been suspended. Please contact support.",
        },
      });
    }

    // 5. Issue server access and refresh tokens
    const serverAccessToken = generateAccessToken(user._id, user.role);
    const serverRefreshToken = generateRefreshToken(user._id);

    user.refreshToken = serverRefreshToken;
    await user.save();

    res.cookie("token", serverAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "KID user authenticated and synchronized successfully",
      accessToken: serverAccessToken,
      refreshToken: serverRefreshToken,
      token: serverAccessToken, // backwards compatibility
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("KID Login Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to authenticate KID account with server",
    });
  }
};
