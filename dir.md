# Directory Map (root → services) + Connections

This repo is a **multi-service Node.js system**. Each service is its own folder with its own `package.json` (there is **no root `package.json`**).

> Note: `node_modules/` and runtime `logs/` are intentionally not expanded here.

## Tree (A→Z)

```text
uber-system/
  .git/                         (git metadata)
  .gitignore
  postman_testing_collection.png
  project.md
  run.md
  dir.md

  gateway/
    app.js
    package.json
    package-lock.json
    middleware/
      morgan.middleware.js
    test/
      gateway.proxy.test.js
    logs/

  user/
    .env
    server.js
    package.json
    package-lock.json
    src/
      app.js
      config/
        config.js
        db.js
      controller/
        user.controller.js
      middleware/
        auth.middleware.js
        morgan.middleware.js
      models/
        blacklisttoken.model.js
        user.model.js
      routes/
        user.routes.js
      service/
        rabbit.js
    test/
      user.api.test.js
    logs/

  captain/
    .env
    server.js
    package.json
    package-lock.json
    src/
      app.js
      config/
        config.js
        db.js
      controller/
        captain.controller.js
      middleware/
        auth.middleware.js
        morgan.middleware.js
      models/
        blacklisttoken.model.js
        captain.model.js
      routes/
        captain.routes.js
      service/
        rabbit.js
    test/
      captain.api.test.js
    logs/

  ride/
    .env
    server.js
    package.json
    package-lock.json
    src/
      app.js
      config/
        config.js
        db.js
      controller/
        ride.controller.js
      middleware/
        auth.middleware.js
        captainAuth.middleware.js
        morgan.middleware.js
      model/
        ride.model.js
      routes/
        ride.routes.js
      service/
        rabbit.js
    test/
      ride.api.test.js
    logs/
```

## Connections (high-level)

### HTTP flow (Gateway → Services)
- `gateway/app.js` exposes:
  - `/v1/api/user/*` → `USER_SERVICE_URL` (defaults to `http://localhost:3001`)
  - `/v1/api/captain/*` → `CAPTAIN_SERVICE_URL` (defaults to `http://localhost:3002`)
  - `/v1/api/ride/*` → `RIDE_SERVICE_URL` (defaults to `http://localhost:3003`)

### Auth flow (shared JWT)
- `user` and `captain` issue JWTs using `JWT_SECRET`.
- `ride` validates JWTs **and** calls upstream profile endpoints via `BASE_URL`:
  - `ride/src/middleware/auth.middleware.js` → `GET ${BASE_URL}/v1/api/user/profile`
  - `ride/src/middleware/captainAuth.middleware.js` → `GET ${BASE_URL}/v1/api/captain/profile`

### RabbitMQ event flow (Ride → Captain/User)
Queues (same names across services):
- `new_ride_requests`
  - Published by: `ride/src/controller/ride.controller.js` (`createRide`)
  - Consumed by: `captain/src/controller/captain.controller.js` (`subscribeToQueue`)
  - Delivered to clients by: `captain/src/controller/captain.controller.js` (`GET /poll-new-ride` long-poll)

- `ride_accepted`
  - Published by: `ride/src/controller/ride.controller.js` (`acceptRide`)
  - Consumed by: `user/src/controller/user.controller.js` (`subscribeToQueue`)
  - Delivered to clients by: `user/src/controller/user.controller.js` (`GET /poll-ride-accepted/:rideId` long-poll)

## Connections (per service)

### gateway/
- `app.js`
  - Imports: `middleware/morgan.middleware.js`
  - Uses: `express-http-proxy` to forward `/v1/api/*` to upstream services.
  - Test behavior: does **not** call `listen()` when `NODE_ENV === 'test'` (so Supertest can import the app).
- `middleware/morgan.middleware.js`
  - Creates `logs/access.log` and also logs to console.
- `test/gateway.proxy.test.js`
  - Verifies gateway health route and that proxying works end-to-end.

### user/
- `server.js`
  - Boot order: `src/config/config.js` → `src/config/db.js` → `src/app.js` → `app.listen()`.
  - Handles graceful shutdown (SIGINT/SIGTERM).
- `src/app.js`
  - Wires middleware + `routes/user.routes.js`.
  - Starts Rabbit connection (`src/service/rabbit.js`).
- `src/routes/user.routes.js`
  - Routes → controller mapping:
    - `POST /register` → `registerUser`
    - `POST /login` → `loginUser`
    - `GET /logout` → `logoutUser`
    - `GET /profile` → `authMiddleware` → `userProfile`
    - `GET /poll-ride-accepted/:rideId` → `authMiddleware` → `pollRideAccepted`
- `src/controller/user.controller.js`
  - DB models: `models/user.model.js`, `models/blacklisttoken.model.js`
  - Rabbit consumer: subscribes to `ride_accepted` and stores payloads in-memory for long-poll delivery.
- `src/middleware/auth.middleware.js`
  - Reads token from `Authorization: Bearer ...` (preferred) or cookies.
  - Rejects blacklisted tokens using `models/blacklisttoken.model.js`.
- `src/service/rabbit.js`
  - RabbitMQ wrapper using `amqplib`.
  - Test/dev convenience: supports in-memory bus when `NODE_ENV=test` or `RABBIT_DRIVER=memory`.
- `test/user.api.test.js`
  - Covers: register/login/profile/logout + auth failures + long-poll behavior.

### captain/
- `server.js` / `src/app.js`
  - Same boot pattern as `user`.
- `src/routes/captain.routes.js`
  - Routes → controller mapping:
    - `POST /register` → `registerCaptain`
    - `POST /login` → `loginCaptain`
    - `GET /logout` → `logoutCaptain`
    - `GET /profile` → `authMiddleware` → `captainProfile`
    - `PATCH /toggle-availability` → `authMiddleware` → `toggleAvailability`
    - `GET /poll-new-ride` → `authMiddleware` → `pollNewRide`
- `src/controller/captain.controller.js`
  - Rabbit consumer: subscribes to `new_ride_requests`.
  - Long-poll delivery: `pollNewRide` returns queued events immediately or waits up to `timeoutMs`.
- `test/captain.api.test.js`
  - Covers: register/login/profile/logout + availability toggle + auth failures + long-poll behavior.

### ride/
- `server.js` / `src/app.js`
  - Same boot pattern as `user`.
- `src/routes/ride.routes.js`
  - `POST /create-ride` → `auth.middleware.js` (user) → `createRide`
  - `PATCH /accept-ride/:rideId` → `captainAuth.middleware.js` (captain) → `acceptRide`
- `src/middleware/auth.middleware.js`
  - Validates JWT and then calls `${BASE_URL}/v1/api/user/profile` to fetch/verify user.
- `src/middleware/captainAuth.middleware.js`
  - Validates JWT and then calls `${BASE_URL}/v1/api/captain/profile` to fetch/verify captain.
- `src/controller/ride.controller.js`
  - DB model: `model/ride.model.js`.
  - Publishes:
    - `new_ride_requests` when ride is created.
    - `ride_accepted` when a captain accepts a ride.
- `test/ride.api.test.js`
  - Covers: create ride + accept ride + auth failures + edge cases (404/409/invalid status).

## Quick navigation (what to open first)
- Architecture + flows: `project.md`
- How to run locally: `run.md`
- Request routing: `gateway/app.js`
- Event-driven core:
  - Publish: `ride/src/controller/ride.controller.js`
  - Consume + long-poll: `captain/src/controller/captain.controller.js`, `user/src/controller/user.controller.js`
