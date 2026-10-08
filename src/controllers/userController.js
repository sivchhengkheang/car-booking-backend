import { User } from "../models/User.js";

const ALLOWED_ROLES = ["CUSTOMER", "HOST", "ADMIN"];
const ALLOWED_STATUSES = ["ACTIVE", "SUSPENDED"];

// Helper to format user response without password
const formatUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status || "ACTIVE",
  phoneNumber: user.phoneNumber,
  driverLicense: user.driverLicense,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// @desc    Update a user's role (Admin only)
// @route   PATCH /api/v1/users/:id/role
// @access  Private / Admin
export const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Validate role input
    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Please provide 'role' (CUSTOMER, HOST, or ADMIN)",
      });
    }

    const normalizedRole = String(role).trim().toUpperCase();
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role '${role}'. Allowed roles are: ${ALLOWED_ROLES.join(", ")}`,
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Safety guard: Admin cannot demote their own admin role to prevent lockout
    if (
      req.user &&
      req.user._id &&
      String(req.user._id) === String(user._id) &&
      normalizedRole !== "ADMIN"
    ) {
      return res.status(400).json({
        success: false,
        message: "You cannot demote your own ADMIN role to prevent system lockout",
      });
    }

    user.role = normalizedRole;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User '${user.name}' role updated to ${normalizedRole} successfully`,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Update User Role Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "User not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while updating user role",
    });
  }
};

// @desc    Suspend or Reactivate a user account (Admin only)
// @route   PATCH /api/v1/users/:id/status
// @access  Private / Admin
export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Please provide 'status' (ACTIVE or SUSPENDED)",
      });
    }

    const normalizedStatus = String(status).trim().toUpperCase();
    if (!ALLOWED_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status '${status}'. Allowed statuses are: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Admin cannot suspend themselves
    if (
      req.user &&
      req.user._id &&
      String(req.user._id) === String(user._id) &&
      normalizedStatus === "SUSPENDED"
    ) {
      return res.status(400).json({
        success: false,
        message: "Admins cannot suspend their own account to prevent lockout",
      });
    }

    user.status = normalizedStatus;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User '${user.name}' status updated to ${normalizedStatus} successfully`,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Update User Status Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "User not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while updating user status",
    });
  }
};

// @desc    Get all users with role, status, search, and pagination (Admin only)
// @route   GET /api/v1/users
// @access  Private / Admin
export const getAllUsers = async (req, res) => {
  try {
    const { role, status, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (role) {
      const normalizedRole = role.toUpperCase();
      if (ALLOWED_ROLES.includes(normalizedRole)) {
        filter.role = normalizedRole;
      }
    }

    if (status) {
      const normalizedStatus = status.toUpperCase();
      if (ALLOWED_STATUSES.includes(normalizedStatus)) {
        filter.status = normalizedStatus;
      }
    }

    if (search) {
      filter.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phoneNumber: new RegExp(search, "i") },
      ];
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get All Users Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching users",
    });
  }
};

// @desc    Get single user details by ID (Admin only)
// @route   GET /api/v1/users/:id
// @access  Private / Admin
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
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
    console.error("Get User By ID Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "User not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching user",
    });
  }
};
