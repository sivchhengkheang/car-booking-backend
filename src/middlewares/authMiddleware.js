import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

// Cache for verified KID tokens to minimize external network latency (TTL 5 minutes)
const kidTokenCache = new Map();

export async function verifyKidOAuthToken(token) {
  if (!token || typeof token !== "string") return null;

  const cached = kidTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const kidBaseUrl = process.env.KID_BASE_URL || "https://api.kid.koompi.org";
    const userinfoUrl = `${kidBaseUrl.replace(/\/+$/, "")}/oauth/userinfo`;

    const response = await fetch(userinfoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const user = data.user || data;

    if (user && user.sub) {
      kidTokenCache.set(token, {
        user,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return user;
    }
    return null;
  } catch (err) {
    console.warn("KID token verification error:", err.message);
    return null;
  }
}

// Protect routes - Verify JWT token or KID OAuth token
export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {
      // 1. Verify standard local JWT
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "default_jwt_secret_key"
      );

      // Get user from token payload (excluding password)
      req.user = await User.findById(decoded.id);

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Not authorized, user not found",
        });
      }

      if (req.user.status === "SUSPENDED") {
        return res.status(403).json({
          success: false,
          error: {
            code: "ACCOUNT_SUSPENDED",
            message: "Your account has been suspended. Please contact support.",
          },
        });
      }

      return next();
    } catch (jwtError) {
      // 2. If JWT verification failed, check if token is a KID OAuth token
      try {
        const kidUser = await verifyKidOAuthToken(token);
        if (kidUser && kidUser.sub) {
          let user = await User.findOne({ sub: kidUser.sub });

          // If not found by sub, check by email to link legacy accounts
          if (!user && kidUser.email) {
            user = await User.findOne({ email: kidUser.email.toLowerCase() });
            if (user) {
              user.sub = kidUser.sub;
              if (kidUser.kid) user.kid = kidUser.kid;
              if (kidUser.wallet?.address) user.walletAddress = kidUser.wallet.address;
              await user.save();
            }
          }

          // If still not found, create new user keyed by sub
          if (!user) {
            user = await User.create({
              sub: kidUser.sub,
              kid: kidUser.kid || "",
              walletAddress: kidUser.wallet?.address || "",
              name: kidUser.name || (kidUser.kid ? `KID User #${kidUser.kid}` : "KID Customer"),
              email: (kidUser.email || `${kidUser.sub}@kid.user`).toLowerCase(),
              phoneNumber: kidUser.phone || kidUser.phoneNumber || "",
              role: "CUSTOMER",
              status: "ACTIVE",
            });
          }

          if (user.status === "SUSPENDED") {
            return res.status(403).json({
              success: false,
              error: {
                code: "ACCOUNT_SUSPENDED",
                message: "Your account has been suspended. Please contact support.",
              },
            });
          }

          req.user = user;
          return next();
        }
      } catch (kidError) {
        // Neither local JWT nor valid KID token
      }

      const isExpired = jwtError?.name === "TokenExpiredError";
      if (!isExpired) {
        console.warn(`[AuthMiddleware] Token invalid: ${jwtError.message}`);
      }

      return res.status(401).json({
        success: false,
        code: isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
        message: isExpired
          ? "Token has expired. Please refresh your token."
          : "Not authorized, token failed or invalid",
      });
    }
  }

  return res.status(401).json({
    success: false,
    message: "Not authorized, no token provided",
  });
};

// Grant access to specific roles
export const authorize = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user?.role?.toUpperCase();
    const normalizedRoles = roles.map((r) => r.toUpperCase());

    if (!req.user || !normalizedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user?.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};
