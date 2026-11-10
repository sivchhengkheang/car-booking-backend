# DriveKH — Backend API

Express 5 & MongoDB REST API powering **DriveKH**, supporting vehicle fleet management, Redis-backed 15-minute booking holds, Baray AES-256-CBC KHQR payments, KOOMPI ID account sync, and Host/Admin operations.

## Tech Stack

- **Runtime & Framework**: Node.js (ES Modules) & Express 5
- **Database & Cache**: MongoDB (`mongoose`) & Redis (`redis`)
- **Auth & Uploads**: JWT (`jsonwebtoken`), `bcryptjs`, `multer` (car photo uploads)

## API Modules

Base prefix: `/api/v1` (with `/api/auth` alias for auth routes).

| Prefix | Highlights |
| --- | --- |
| `/api/v1/health` | Service health check (MongoDB & Redis status) |
| `/api/v1/auth` | Register, login, refresh token, logout, password reset/update, profile (`GET /me`), KOOMPI ID login sync |
| `/api/v1/users` | Admin user listing/search, user detail, role updates (`CUSTOMER`/`HOST`/`ADMIN`), account status (`ACTIVE`/`SUSPENDED`) |
| `/api/v1/cars` | Public browse/filter/sort/booked-dates/reviews; Host/Admin CRUD, up to 5 photo uploads (`/uploads/cars`), status updates, photo deletion |
| `/api/v1/bookings` | Quote, 15-minute hold creation/extension/cancellation, customer/host/admin listings, pick-up confirmation, return completion, reviews |
| `/api/v1/payments` | Baray checkout intent creation (`POST /checkout`), Baray webhook (`POST /webhook/baray`), promo validation, payment history, admin refunds |
| `/api/v1/admin/stats` | Admin user, fleet, booking status breakdown, and all-time/period revenue stats |

## Background Services

- `startBookingCleanupWorker`: Periodically cleans up expired unpaid `PENDING_PAYMENT` / `PROVISIONAL` booking holds and releases Redis locks.

## Environment Variables

Create `backend/.env`:

```env
PORT=5000
CLIENT_URL=http://localhost:3000
MONGO_URI=mongodb://localhost:27017/car_booking
REDIS_URL=redis://localhost:6379
JWT_SECRET=<your-jwt-secret>

BARAY_API_KEY=<your-baray-api-key>
BARAY_SK=<your-baray-secret-key>
BARAY_IV=<your-baray-iv>
```

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — Start development server with `nodemon`
- `npm start` — Start production server (`node src/server.js`)
