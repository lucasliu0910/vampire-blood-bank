# Vampire Blood Bank

A local blood bank prototype with a React interface and Python / FastAPI backend. Managers manage stock, vampires place orders, and donors contribute blood. The interface is in English. This is a fictional demo; donations immediately enter inventory and orders immediately deduct it.

## Run

Install and start Docker Desktop, then run from this directory:

```sh
docker compose up --build -d
```

Open http://localhost:8080. No host Python, Node, npm, or pip installation is required. All application packages are installed in Docker. To use a different local port: `PORT=8081 docker compose up --build -d`.

| Role | Username | Password |
| --- | --- | --- |
| Manager | manager | Manager123! |
| Vampire | vampire | Vampire123! |
| Donor | donor | Donor123! |

These are local demo credentials, also displayed on the sign-in page. Do not expose this prototype publicly with these credentials.

## Behavior

- Manager: inspect stock and all activity; set stock to an absolute quantity with a required audit reason.
- Vampire: see stock, order 1–100 bags, and see only their own activity. Insufficient stock is rejected.
- Donor: donate 1–100 bags and see only their own activity.
- All eight ABO/Rh blood types are available. One bag is one inventory unit. No clinical compatibility rules are applied.
- Inventory starts with sample stock; transaction history starts empty.
- Each blood type can store up to 10,000 bags.
- No registration, payment, delivery, approval workflow, or clinical screening is included.

## Storage and authentication

On first startup, the backend creates `/app/data/users.json` and `/app/data/bank.json` in the `blood-bank-data` named Docker volume. Passwords use salted PBKDF2-SHA256 hashes (600,000 iterations). Password hashes are never returned through the API. Authentication uses an HttpOnly, SameSite=Strict session cookie with a 12-hour expiry. HTTPS enables the cookie's Secure flag. Sessions live in memory: restarting the app signs everyone out, while users, inventory, and transactions persist.

The server runs as a non-root user with **one worker**. An in-process lock and atomic file replacement protect concurrent mutations. Stock and its activity record are written together. This JSON storage design is for a single-container prototype; do not scale replicas or workers. A database is needed before scaling.

Change seeded accounts by editing the volume's `users.json` with the app stopped. Each user requires a unique `id`, `username`, `name`, `role` (`manager`, `vampire`, or `donor`), and a compatible `password_hash`. To generate a hash entirely inside Docker:

```sh
docker compose exec app python -c 'import getpass; from backend.app import password_hash; print(password_hash(getpass.getpass("New password: ")))'
```

## Useful commands

```sh
# Status and logs
docker compose ps
docker compose logs -f app

# Stop, preserving data
docker compose down

# Rebuild after source changes
docker compose up --build -d

# Run backend tests entirely inside Docker (isolated temporary data)
docker build --target test -t vampire-blood-bank-test .
docker run --rm vampire-blood-bank-test
```

To intentionally erase all users, stock, and history and restore seed data, run `docker compose down -v`, then start again. This is destructive.

The browser and API share one origin. The Compose port is bound to localhost. API documentation is at http://localhost:8080/docs; health is at `/api/health`.
