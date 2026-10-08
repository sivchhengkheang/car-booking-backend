# Car Booking API Endpoints Reference (v2 – Improved)

**Base URL:** `http://localhost:5000`
**API prefix:** `/api/v1`
**Legend:** 🆕 new endpoint · ✏️ changed from v1 · 🔒 security-sensitive

---

## 0. Conventions

### Authentication
- Header: `Authorization: Bearer <accessToken>`
- Access token lifetime: 15 min. Use `POST /api/v1/auth/refresh` with a refresh token to get a new one.

### Access levels
| Label | Meaning |
|---|---|
| Public | No token needed |
| Auth | Any logged-in user |
| Customer / Host / Admin | Role required |
| Host (Owner) | Host who owns the car in question, or Admin |
| Owner | The user who owns the resource, or Admin |

---

## 1. System Health
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/` | Public | Basic server alive check |
| `GET` | `/api/v1/health` 🆕 | Public | Detailed health: DB, cache, uptime, version |

---

## 2. Authentication (`/api/v1/auth`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` ✏️🔒 | Public | `{ name, email, password, phoneNumber, role? }` | Register (`CUSTOMER` or `HOST` only; `ADMIN` rejected) |
| `POST` | `/api/v1/auth/login` | Public | `{ email, password }` | Returns `{ accessToken, refreshToken, token, user }` |
| `POST` | `/api/v1/auth/refresh` 🆕 | Public | `{ refreshToken }` | Issue new access token |
| `POST` | `/api/v1/auth/logout` 🆕 | Auth | `{ refreshToken? }` | Revoke refresh token |
| `POST` | `/api/v1/auth/forgot-password` 🆕 | Public | `{ email }` | Send/generate reset token |
| `POST` | `/api/v1/auth/reset-password` 🆕 | Public | `{ token, newPassword }` | Complete password reset |
| `GET` | `/api/v1/auth/me` | Auth | *(None)* | Profile of logged-in user |
| `PATCH` | `/api/v1/auth/profile` ✏️ | Auth | `{ name?, phoneNumber?, driverLicense? }` | Partial profile update (PUT also supported) |
| `PATCH` | `/api/v1/auth/password` ✏️ | Auth | `{ currentPassword, newPassword }` | Change password (PUT also supported) |

---

## 3. Users Management (`/api/v1/users`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/users` | Admin | `?role=&search=&status=&page=&limit=` | List users with pagination |
| `GET` | `/api/v1/users/:id` | Admin | *(None)* | Single user details |
| `PATCH` | `/api/v1/users/:id/role` ✏️ | Admin | `{ role: "CUSTOMER"\|"HOST"\|"ADMIN" }` | Change user role |
| `PATCH` | `/api/v1/users/:id/status` 🆕 | Admin | `{ status: "ACTIVE"\|"SUSPENDED" }` | Suspend or reactivate user account |

---

## 4. Cars Catalog & Management (`/api/v1/cars`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/cars` ✏️ | Public *(Cached)* | `?brand=&category=&minPrice=&maxPrice=&city=&start=&end=&page=&limit=&sort=` | Browse cars with pagination & sorting |
| `GET` | `/api/v1/cars/my` 🆕 | Host / Admin | `?status=&page=&limit=` | Host's own listings (all statuses) |
| `GET` | `/api/v1/cars/:id` | Public *(Cached)* | *(None)* | Car specs & host details |
| `GET` | `/api/v1/cars/:id/booked-dates` ✏️ | Public *(Cached)* | *(None)* | Booked calendar ranges & `holdExpiresAt` |
| `GET` | `/api/v1/cars/:id/reviews` 🆕 | Public | `?page=&limit=` | Public reviews and average rating |
| `POST` | `/api/v1/cars` | Host / Admin | `multipart/form-data`: specs, photos, etc. | Create listing |
| `PATCH` | `/api/v1/cars/:id` ✏️ | Host (Owner) / Admin | `multipart/form-data` or JSON | Partial update specs, status & photos |
| `PATCH` | `/api/v1/cars/:id/status` | Host (Owner) / Admin | `{ status?: "AVAILABLE"\|"UNAVAILABLE"\|"MAINTENANCE", isAvailable?: boolean }` | Quick status toggle |
| `DELETE` | `/api/v1/cars/:id` 🆕 | Host (Owner) / Admin | *(None)* | Soft delete (rejected 409 if active bookings exist) |
| `DELETE` | `/api/v1/cars/:id/photos/:photoId` 🆕 | Host (Owner) / Admin | *(None)* | Remove single photo by index or filename |

---

## 5. Bookings & Checkout Hold (`/api/v1/bookings`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/bookings/quote` 🆕 | Customer | `{ carId, startDate, endDate }` | Price preview quote (creates nothing) |
| `POST` | `/api/v1/bookings` ✏️ | Customer | `{ carId, startDate, endDate }` + `Idempotency-Key` | Create booking & acquire 15-min hold (`holdExpiresAt`) |
| `GET` | `/api/v1/bookings/my` | Customer | `?status=&page=&limit=` | Customer's booking history |
| `GET` | `/api/v1/bookings/host` 🆕 | Host / Admin | `?status=&carId=&page=&limit=` | Bookings for host's cars |
| `GET` | `/api/v1/bookings` 🆕 | Admin | `?status=&carId=&userId=&from=&to=&page=&limit=` | All system bookings |
| `GET` | `/api/v1/bookings/:id` 🆕 | Owner / Host / Admin | *(None)* | Booking details and breakdown |
| `PATCH` | `/api/v1/bookings/:id/cancel` ✏️ | Customer (Owner) / Admin | `{ reason? }` | Cancel booking & release hold |
| `PATCH` | `/api/v1/bookings/:id/confirm` ✏️ | Host (Owner) / Admin | *(None)* | Confirm pickup → status `ACTIVE` |
| `PATCH` | `/api/v1/bookings/:id/complete` 🆕 | Host (Owner) / Admin | `{ returnNotes?, damageReported?, fuelLevel?, mileage? }` | Confirm return → status `COMPLETED` |
| `POST` | `/api/v1/bookings/:id/review` 🆕 | Customer (Owner) | `{ rating: 1-5, comment? }` | Submit review for completed booking |

---

## 6. Payments & Webhook (`/api/v1/payments`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/payments/checkout` ✏️ | Customer | `{ bookingId, successUrl?, cancelUrl? }` + `Idempotency-Key` | Validates hold & creates Baray payment URL |
| `GET` | `/api/v1/payments/booking/:bookingId` 🆕 | Owner / Admin | *(None)* | Check payment status by booking ID |
| `GET` | `/api/v1/payments/my` | Customer | `?page=&limit=` | Customer transaction history |
| `GET` | `/api/v1/payments` | Admin | `?status=&from=&to=&page=&limit=` | All payments with pagination |
| `GET` | `/api/v1/payments/:id` | Owner / Admin | *(None)* | Single payment record |
| `POST` | `/api/v1/payments/:id/refund` 🆕 | Admin | `{ amount?, reason }` | Process payment refund |
| `POST` | `/api/v1/payments/webhook/baray` | Public Webhook | `{ encrypted_order_id, bank }` | Baray payment webhook |

---

## 7. Admin Dashboard (`/api/v1/admin`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/v1/admin/stats` 🆕 | Admin | Dashboard metrics: users, active cars, bookings by status, total & period revenue |
