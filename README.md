# Full-Stack Internet Radio Streaming System

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0%2B-4479A1?style=flat&logo=mysql&logoColor=white)](https://www.mysql.com/)
[![HTML5 Audio](https://img.shields.io/badge/HTML5%20Audio-API-E34F26?style=flat&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/HTML5)
[![SRS Compliance](https://img.shields.io/badge/SRS%20v2.0-Backend%20Compliant-10b981)](tests/api-test-checklist.md)

A complete full-stack web-based internet radio streaming platform developed strictly according to **Software Requirements Specification (SRS v2.0 - Backend-enabled)** and the **Implementation Plan**. The system combines an accessible, responsive browser audio player with a secure **Node.js/Express REST API** and a persistent **MySQL database** (with automatic zero-config local fallback), featuring role-based access control, program schedules, user accounts, personal favourites, and an administrative station manager.

---

## 📻 Features & Full-Stack Capabilities

| Requirement ID | Specification Area | Implementation Detail |
| :--- | :--- | :--- |
| **FR-01 & FR-02** | Station Discovery & Details | Public station catalogue with live search, genre filters, and details loaded dynamically from `/api/stations`. |
| **FR-03 & FR-04** | Live Audio Player | HTML5 Audio engine supporting Play, Pause, Resume, Volume slider, and one-click Mute state restoration. |
| **FR-05 & FR-06** | State & Error Handling | Clear visual & textual states (**Ready**, **Connecting**, **Live Broadcast**, **Paused**, **Buffering**, **Stream Error**) with an interactive **Retry** action. |
| **FR-07 & FR-08** | Authentication Lifecycle | Registration and login using `bcrypt` password hashing (salt factor 10) and secure JWT stored in `HttpOnly` cookies. Safe output excludes password hashes. |
| **FR-09** | Personal Favourites | Registered listeners can star/unstar stations. Persisted via composite primary key `(user_id, station_id)` in the database. |
| **FR-10** | Program Schedules | Published daily program guides for stations with broadcast hours and show descriptions (`/api/stations/:id/schedules`). |
| **FR-11 & FR-12** | Admin Station & Schedule CRUD | Authorized administrators can create, edit, activate/deactivate, and delete stations and program schedules via protected endpoints. |
| **FR-13** | Role-Based Authorization | Server-side authorization middleware (`requireAdmin`). Rejects unauthorized listener or guest requests with HTTP 403 Forbidden. |
| **FR-14** | Input & Range Validation | Validates email syntax, stream URL formats, and checks schedule time ranges (`start_time != end_time` and format `HH:MM`). |
| **FR-15** | Persistent Storage | Full relational schema for `users`, `stations`, `program_schedules`, and `favourites` persisted in MySQL. |
| **FR-16** | Responsive Design | Mobile-first CSS layout with WCAG AA compliant contrast, 44px+ touch targets, and keyboard navigation. |
| **FR-17** | Icecast Compatibility | Compatible with self-hosted Icecast 2.4 server mounts (`/live.mp3`) and direct HTTPS live streams. |

---

## 📂 Repository Structure

```text
internet-radio/
├── backend/
│   ├── src/
│   │   ├── app.js               # Express application, Helmet security, CORS, routes
│   │   ├── server.js            # HTTP server entrypoint and database bootstrap
│   │   ├── config/
│   │   │   └── db.js            # MySQL connection pool (mysql2/promise) with auto-schema
│   │   ├── controllers/         # Business logic for stations, schedules, auth, favourites
│   │   ├── middleware/          # JWT auth, requireAdmin role check, rate limiter, error handling
│   │   ├── routes/              # REST API route definitions (/api/*)
│   │   └── validators/          # Input schema and time-range validation
│   ├── sql/
│   │   ├── schema.sql           # MySQL table creation scripts
│   │   └── seed.sql             # Default stations, admin, and listener seed records
│   ├── .env.example             # Environment variable template
│   └── package.json             # Backend dependencies and npm scripts
├── frontend/
│   ├── index.html               # Main live player with program guide & event diagnostics
│   ├── stations.html            # Station catalogue with live search and genre pills
│   ├── station.html             # Dedicated station detail and schedule page
│   ├── login.html               # Sign in page with pre-seeded demo quick-fill buttons
│   ├── register.html            # Listener registration page
│   ├── favourites.html          # Listener's saved favourite stations
│   ├── admin/
│   │   ├── stations.html        # Admin station management table with Add/Edit modal
│   │   └── schedules.html       # Admin schedule manager with time-range validation
│   ├── css/
│   │   └── styles.css           # Responsive design system, glowing player cards, dark theme
│   ├── js/
│   │   ├── api.js               # Central fetch API client with token & credentials handling
│   │   ├── auth.js              # Auth state manager and dynamic navigation bar
│   │   ├── player.js            # HTML5 Audio playback controller and event engine
│   │   ├── stations.js          # Catalogue renderer and favourite toggle
│   │   └── admin.js             # Admin station & schedule CRUD interface
│   └── assets/                  # High-resolution vector logos and artwork
├── tests/
│   ├── api-test-checklist.md    # Complete T-01 through T-16 API acceptance matrix
│   └── test_api_endpoints.py    # Automated test runner verifying all acceptance criteria
├── run.bat                      # One-click full-stack launcher (starts server & opens browser)
├── start.bat                    # Launcher shortcut
└── README.md                    # Project documentation
```

---

## 🚀 Quick Start / How to Run the Backend

### Method 1: One-Click Launcher (Recommended)
Simply **double-click `run.bat`** (or `start.bat`).  
The launcher will:
1. Start the **Backend REST API Server** (Node.js/Express) on port 5000 in a dedicated green terminal window.
2. Start the **Dedicated Frontend Server** on port 8080 in a dedicated blue terminal window.
3. Automatically launch your default web browser to **`http://localhost:5000`**.
4. Keep a control dashboard open where pressing any key cleanly shuts down **both** servers.

### Method 2: Manual Node.js Terminal Launch
```powershell
cd backend
npm install
npm start
```
Then open **`http://localhost:5000`** in your browser.

---

## 🔐 Pre-Seeded Demo Credentials

The database comes pre-seeded with accounts ready for evaluator and supervisor testing:

| Role | Email Address | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@pulsecast.com` | `AdminPassword123!` | Full station CRUD, schedule management, active toggling |
| **Listener** | `listener@pulsecast.com` | `ListenerPass123!` | Live streaming, browsing catalogue, personal favourites |

*(Quick-fill buttons are provided directly on the [login page](http://localhost:5000/login.html) for fast one-click sign in!)*

---

## 🗄️ MySQL Database Setup & Configuration

### 1. Connecting to Local MySQL
To connect the backend to your running MySQL instance:
1. Open `backend/.env` (or copy from `backend/.env.example`).
2. Update your MySQL root password:
   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=YourMySQLPasswordHere
   DB_NAME=internet_radio
   ```
3. When you run `npm start`, the backend will **automatically create the database**, apply `schema.sql`, and seed initial records.

### 2. Manual SQL Execution (Optional)
If you prefer running the SQL script manually in MySQL Workbench or the `mysql` CLI:
```powershell
mysql -u root -p < backend/sql/schema.sql
mysql -u root -p < backend/sql/seed.sql
```

> **Automatic Fallback Note (T-15 Resilience):**  
> If MySQL is temporarily offline or credentials are not yet configured in `.env`, the backend automatically falls back to an embedded SQLite database (`data/radio.db`). This ensures the full-stack system **runs instantly without configuration errors**, allowing you to test all APIs and UI features immediately while configuring MySQL!

---

## 📡 REST API Reference

| Method | Endpoint | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | System and database health status |
| `GET` | `/api/stations` | Public | List active radio stations (supports `?genre=...&search=...`) |
| `GET` | `/api/stations/:id` | Public | Get single station details by ID |
| `GET` | `/api/stations/:id/schedules` | Public | Get published program schedules for a station |
| `POST` | `/api/auth/register` | Public | Register a new listener account (hashed with `bcrypt`) |
| `POST` | `/api/auth/login` | Public | Sign in and receive JWT in HttpOnly cookie |
| `POST` | `/api/auth/logout` | Authenticated | Sign out and invalidate cookie |
| `GET` | `/api/auth/me` | Authenticated | Get current logged-in user profile |
| `GET` | `/api/favourites` | Listener | List current listener's favourite stations |
| `POST` | `/api/favourites/:stationId` | Listener | Add station to favourites |
| `DELETE` | `/api/favourites/:stationId` | Listener | Remove station from favourites |
| `POST` | `/api/admin/stations` | Admin | Create a new radio station record |
| `PUT` | `/api/admin/stations/:id` | Admin | Update station details |
| `PATCH` | `/api/admin/stations/:id/status`| Admin | Activate or deactivate a station |
| `DELETE` | `/api/admin/stations/:id` | Admin | Delete a station record |
| `POST` | `/api/admin/stations/:id/schedules`| Admin | Create program schedule entry |
| `PUT` | `/api/admin/schedules/:id` | Admin | Update program schedule |
| `DELETE` | `/api/admin/schedules/:id` | Admin | Delete program schedule |

---

## 🧪 Automated Test Suite Execution

You can run the complete API acceptance test suite at any time:
```powershell
python tests/test_api_endpoints.py
```
This tests and verifies all requirements: health checks, station retrieval, duplicate registration rejection, JWT validation, admin role authorization checks (negative testing), schedule range validation, and station/schedule CRUD.

See [tests/api-test-checklist.md](tests/api-test-checklist.md) for the complete acceptance matrix.
