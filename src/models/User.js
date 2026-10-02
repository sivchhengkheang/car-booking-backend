import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true },
        password: { type: String, required: true, select: false },
        role: {
            type: String,
            enum: ["USER", "MANAGER", "ADMIN"],
            default: "USER"
        },
        phoneNumber: { type: String, required: true },
        driverLicense: {
            idNumber: String,
            frontImageUrl: String,
            backImageUrl: String,
            verifiedStatus: {
                type: String,
                enum: ["UNVERIFIED", "PENDING", "APPROVED", "REJECTED"],
                default: "UNVERIFIED"
            }
        }
    },
    { timestamps: true }
);

export const User = mongoose.model("User", userSchema);