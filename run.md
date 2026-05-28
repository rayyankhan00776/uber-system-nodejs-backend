# Run / Setup Guide (Local)

This repo contains 4 Node.js services:

- `gateway` (API Gateway) — `localhost:3000`
- `user` — `localhost:3001`
- `captain` — `localhost:3002`
- `ride` — `localhost:3003`

The system requires:

- **MongoDB**
- **RabbitMQ**

For a deeper architecture + API reference, see `project.md`.

---

## 0) Prerequisites

- Node.js **18+** (recommended)
- npm (comes with Node)
- MongoDB running locally OR via Docker
- RabbitMQ running locally OR via Docker

---

## 1) Get the code (GitHub)

### Option A: Clone

```bash
git clone <YOUR_GITHUB_REPO_URL>
cd uber-system
```

### Option B: Download ZIP

- Open the repo on GitHub
- Click **Code** → **Download ZIP**
- Extract it
- `cd` into the extracted folder

---

## 2) Install dependencies

Install each service separately:

```bash
cd gateway && npm install
cd ../user && npm install
cd ../captain && npm install
cd ../ride && npm install
```

---

## 3) Configure environment variables

The `.env` files are intentionally ignored by git.

Create the following files:

- `user/.env`
- `captain/.env`
- `ride/.env`

### 3.1 Required env vars

#### `user/.env`

```env
PORT=3001
MONGO_URI=mongodb://127.0.0.1:27017/uber_system
JWT_SECRET=change-me-to-a-long-random-string
RABBIT_URI=amqp://localhost:5672
```

#### `captain/.env`

```env
PORT=3002
MONGO_URI=mongodb://127.0.0.1:27017/uber_system
JWT_SECRET=change-me-to-a-long-random-string
RABBIT_URI=amqp://localhost:5672
```

#### `ride/.env`

```env
PORT=3003
MONGO_URI=mongodb://127.0.0.1:27017/uber_system
JWT_SECRET=change-me-to-a-long-random-string
BASE_URL=http://localhost:3000
RABBIT_URI=amqp://localhost:5672
```

### 3.2 Important notes

- `JWT_SECRET` **must be identical** in `user`, `captain`, and `ride`.
  - The ride service verifies user/captain JWTs locally.
- `BASE_URL` is used by the ride service to call:
  - `GET /v1/api/user/profile`
  - `GET /v1/api/captain/profile`

So `BASE_URL` should usually point to the **gateway** (`http://localhost:3000`).

---

## 4) Start MongoDB + RabbitMQ

### Option A (recommended): Docker

MongoDB:

```bash
docker run -d --name uber-mongo -p 27017:27017 mongo:7
```

RabbitMQ (with management UI):

```bash
docker run -d --name uber-rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

RabbitMQ Management UI:

- URL: `http://localhost:15672`
- default login: `guest` / `guest`

Stop + remove containers later:

```bash
docker stop uber-mongo uber-rabbit
docker rm uber-mongo uber-rabbit
```

### Option B: Run them locally

- Start MongoDB on `mongodb://127.0.0.1:27017`
- Start RabbitMQ on `amqp://localhost:5672`

---

## 5) Start the services

Open **4 terminals** (or tabs) and start each service.

### Terminal 1 — user

```bash
cd user
npm run dev
```

### Terminal 2 — captain

```bash
cd captain
npm run dev
```

### Terminal 3 — ride

```bash
cd ride
npm run dev
```

### Terminal 4 — gateway

```bash
cd gateway
npm run dev
```

Once everything is running, test the gateway:

- `GET http://localhost:3000/` → `Welcome to the API Gateway of the Uber System!`

---

## 6) End-to-end test flow (curl)

Base URL:

```bash
BASE=http://localhost:3000
```

### 6.1 Register + login a user

```bash
curl -s -X POST "$BASE/v1/api/user/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice","email":"alice@example.com","password":"pass1234"}'
```

Login:

```bash
curl -s -X POST "$BASE/v1/api/user/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"pass1234"}'
```

Copy the `token` from the JSON response and store it as `USER_TOKEN`.

### 6.2 Register + login a captain

```bash
curl -s -X POST "$BASE/v1/api/captain/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bob","email":"bob@example.com","password":"pass1234"}'
```

Login:

```bash
curl -s -X POST "$BASE/v1/api/captain/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"bob@example.com","password":"pass1234"}'
```

Copy the `token` from the JSON response and store it as `CAPTAIN_TOKEN`.

### 6.3 Create a ride (as user)

```bash
curl -s -X POST "$BASE/v1/api/ride/create-ride" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pickup":"Airport","destination":"Downtown"}'
```

Copy the returned ride id (`data._id`) as `RIDE_ID`.

### 6.4 Captain polls for new ride (long poll)

In another terminal (or after creating the ride), run:

```bash
curl -s "$BASE/v1/api/captain/poll-new-ride?timeoutMs=25000" \
  -H "Authorization: Bearer $CAPTAIN_TOKEN"
```

If a ride request is available, you’ll get `message: "New ride available"` with the ride payload.

### 6.5 Captain accepts the ride

```bash
curl -s -X PATCH "$BASE/v1/api/ride/accept-ride/$RIDE_ID" \
  -H "Authorization: Bearer $CAPTAIN_TOKEN"
```

### 6.6 User polls for acceptance (long poll)

```bash
curl -s "$BASE/v1/api/user/poll-ride-accepted/$RIDE_ID?timeoutMs=25000" \
  -H "Authorization: Bearer $USER_TOKEN"
```

Expected: `message: "Ride accepted"` and acceptance payload.

---

## 7) Troubleshooting

### MongoDB connection issues

- Symptom: service exits with “MongoDB connection error”
- Fix: confirm `MONGO_URI` is correct and MongoDB is running.

### RabbitMQ connection issues

- Symptom: errors from `amqplib.connect(...)`
- Fix: confirm `RABBIT_URI` and RabbitMQ is running.

### 401 from ride endpoints

- Most common causes:
  - `JWT_SECRET` mismatch across services
  - `BASE_URL` not pointing to the gateway
  - Using cookies for both user + captain in the same browser session

Recommendation: always pass tokens via `Authorization: Bearer ...`.

---

## 8) What to read next

- `project.md` — detailed architecture, message queues, schemas, and full API reference
