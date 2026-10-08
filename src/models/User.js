import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: {
            type: String,
            required: function () {
                return !this.sub;
            },
            select: false,
        },
        sub: { type: String, unique: true, sparse: true, index: true },
        kid: { type: String, sparse: true },
        walletAddress: { type: String, sparse: true },
        role: {
            type: String,
            enum: ["CUSTOMER", "HOST", "ADMIN"],
            default: "CUSTOMER"
        },
        phoneNumber: { type: String, default: "" },
        driverLicense: {
            idNumber: String,
            frontImageUrl: String,
            backImageUrl: String,
            verifiedStatus: {
                type: String,
                enum: ["UNVERIFIED", "PENDING", "APPROVED", "REJECTED"],
                default: "UNVERIFIED"
            }
        },
        status: {
            type: String,
            enum: ["ACTIVE", "SUSPENDED"],
            default: "ACTIVE"
        },
        refreshToken: { type: String, select: false },
        resetPasswordToken: { type: String, select: false },
        resetPasswordExpire: { type: Date, select: false }
    },
    { timestamps: true }
);

export const User = mongoose.model("User", userSchema);