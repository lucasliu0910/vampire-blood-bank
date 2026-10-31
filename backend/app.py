import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BLOOD_TYPES = ("O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-")
BloodType = Literal["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", "/app/static"))
lock = threading.RLock()
sessions = {}
login_attempts = defaultdict(deque)
SESSION_SECONDS = 12 * 60 * 60

# Single-use "are you a vampire?" challenges: id -> {answer, expires}. In memory, like sessions.
captchas = {}
CAPTCHA_SECONDS = 120
CAPTCHA_MAX_PENDING = 1000
# (question, correct answer, three wrong answers)
CAPTCHA_QUESTIONS = [
    ("What do you see when you look in a mirror?", "Nothing at all", ["A rather tired face", "The sunrise", "A very small bat"]),
    ("Which of these should never be stored in the refrigerator?", "Holy water", ["O-negative", "AB-positive", "Anything labelled 'reserve'"]),
    ("When must you be safely indoors?", "Before sunrise", ["Before brunch", "Before the 9 a.m. meeting", "After the second coffee"]),
    ("Which blood type is the universal red-cell donor?", "O-negative", ["A-positive", "AB-positive", "B-negative"]),
    ("A stranger's house requires one thing before you may enter. What?", "An invitation", ["A loyalty card", "A password reset", "A firm handshake"]),
    ("Which of these is most likely to ruin your evening?", "Garlic bread", ["Moonlight", "A velvet cape", "A midnight snack"]),
    ("What is the correct way to greet the dawn?", "You don't", ["With a hearty breakfast", "With sunglasses", "With a morning jog"]),
]

def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as output:
        json.dump(data, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000).hex()
    return f"pbkdf2_sha256$600000${salt}${digest}"


def verify_password(password, stored):
    _, iterations, salt, digest = stored.split("$")
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
    return hmac.compare_digest(actual, digest)


def initialize_data():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with lock:
        if not (DATA_DIR / "users.json").exists():
            users = [
                {"id": "manager", "username": "manager", "name": "Morgan Vale", "role": "manager", "password_hash": password_hash("Manager123!")},
                {"id": "vampire", "username": "vampire", "name": "Count Adrian", "role": "vampire", "password_hash": password_hash("Vampire123!")},
                {"id": "donor", "username": "donor", "name": "Robin Ash", "role": "donor", "password_hash": password_hash("Donor123!")},
            ]
            write_json(DATA_DIR / "users.json", users)
        if not (DATA_DIR / "bank.json").exists():
            write_json(DATA_DIR / "bank.json", {"inventory": dict(zip(BLOOD_TYPES, [24, 12, 18, 8, 16, 6, 10, 4])), "transactions": []})


@asynccontextmanager
async def lifespan(app):
    initialize_data()
    yield


app = FastAPI(title="Vampire Blood Bank", lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Cookie auth is same-origin only. Do not enable permissive CORS.
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin and origin != str(request.base_url).rstrip("/"):
        return Response(status_code=403, content="Cross-origin request denied")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def public_user(user):
    return {key: user[key] for key in ("id", "username", "name", "role")}


def current_user(request: Request):
    token = request.cookies.get("blood_session", "")
    with lock:
        session = sessions.get(hashlib.sha256(token.encode()).hexdigest())
        if not session or session["expires"] <= time.time():
            raise HTTPException(401, "Please sign in to continue.")
        users = json.loads((DATA_DIR / "users.json").read_text())
        user = next((u for u in users if u["id"] == session["user_id"]), None)
    if not user:
        raise HTTPException(401, "Please sign in again.")
    return public_user(user)


User = Annotated[dict, Depends(current_user)]


def require_role(user, role):
    if user["role"] != role:
        raise HTTPException(403, "Your account cannot perform this action.")


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)
    captcha_id: str = Field(min_length=1, max_length=100)
    captcha_answer: str = Field(min_length=1, max_length=100)


class BloodRequest(BaseModel):
    blood_type: BloodType
    units: int = Field(strict=True, ge=1, le=100)


class Adjustment(BaseModel):
    blood_type: BloodType
    units: int = Field(strict=True, ge=0, le=10000)
    reason: str = Field(min_length=3, max_length=200)


@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/captcha")
def captcha():
    question, answer, wrong = secrets.choice(CAPTCHA_QUESTIONS)
    options = [answer, *wrong]
    secrets.SystemRandom().shuffle(options)
    with lock:
        now = time.time()
        for key in [k for k, v in captchas.items() if v["expires"] <= now]:
            del captchas[key]
        while len(captchas) >= CAPTCHA_MAX_PENDING:
            del captchas[next(iter(captchas))]  # drop the oldest
        captcha_id = secrets.token_urlsafe(16)
        captchas[captcha_id] = {"answer": answer, "expires": now + CAPTCHA_SECONDS}
    return {"id": captcha_id, "question": question, "options": options}

@app.post("/api/login")
def login(payload: Login, request: Request, response: Response):
    with lock:
        now = time.time()
        for key in list(sessions):
            if sessions[key]["expires"] <= now:
                del sessions[key]
        for key in list(login_attempts):
            if not login_attempts[key] or login_attempts[key][-1] <= now - 60:
                del login_attempts[key]
        address = request.client.host if request.client else "unknown"
        attempts = login_attempts[address]
        while attempts and attempts[0] <= now - 60:
            attempts.popleft()
        if len(attempts) >= 10:
            raise HTTPException(429, "Too many sign-in attempts. Please wait a minute.")
        attempts.append(now)
        # Challenges are single-use: popped whether the answer is right or wrong.
        challenge = captchas.pop(payload.captcha_id, None)
        if not challenge or challenge["expires"] <= now or not hmac.compare_digest(challenge["answer"].encode(), payload.captcha_answer.encode()):
            raise HTTPException(400, "Vampire verification failed. A true vampire would know that. Try the new question.")
        users = json.loads((DATA_DIR / "users.json").read_text())
        user = next((u for u in users if u["username"] == payload.username), None)
        # Use a real password hash even when the username does not exist.
        valid = verify_password(payload.password, (user or users[0])["password_hash"])
        if not user or not valid:
            raise HTTPException(401, "The username or password is incorrect.")
        previous = request.cookies.get("blood_session", "")
        sessions.pop(hashlib.sha256(previous.encode()).hexdigest(), None)
        token = secrets.token_urlsafe(32)
        sessions[hashlib.sha256(token.encode()).hexdigest()] = {"user_id": user["id"], "expires": now + SESSION_SECONDS}
    response.set_cookie("blood_session", token, httponly=True, samesite="strict", secure=request.url.scheme == "https", max_age=SESSION_SECONDS, path="/")
    return public_user(user)


@app.post("/api/logout", status_code=204)
def logout(request: Request, response: Response):
    with lock:
        token = request.cookies.get("blood_session", "")
        sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)
    response.delete_cookie("blood_session", path="/")


@app.get("/api/me")
def me(user: User):
    return user


@app.get("/api/dashboard")
def dashboard(user: User):
    with lock:
        state = json.loads((DATA_DIR / "bank.json").read_text())
    transactions = state["transactions"]
    if user["role"] != "manager":
        transactions = [t for t in transactions if t["user_id"] == user["id"]]
    return {"inventory": state["inventory"], "transactions": list(reversed(transactions))}


def transact(user, kind, blood_type, units, reason=""):
    # One lock + one atomic JSON replacement keeps stock and history consistent.
    with lock:
        state = json.loads((DATA_DIR / "bank.json").read_text())
        before = state["inventory"][blood_type]
        if kind == "order" and units > before:
            raise HTTPException(409, "Not enough stock. Please choose a smaller quantity or another blood type.")
        after = units if kind == "adjustment" else before + (units if kind == "donation" else -units)
        if after > 10000:
            raise HTTPException(409, "This blood type has reached its storage capacity.")
        record = {"id": secrets.token_hex(6), "kind": kind, "user_id": user["id"], "name": user["name"], "blood_type": blood_type, "units": units, "change": after - before, "reason": reason, "created_at": datetime.now(timezone.utc).isoformat()}
        state["inventory"][blood_type] = after
        state["transactions"].append(record)
        write_json(DATA_DIR / "bank.json", state)
    return record


@app.post("/api/orders", status_code=201)
def order(payload: BloodRequest, user: User):
    require_role(user, "vampire")
    return transact(user, "order", payload.blood_type, payload.units)


@app.post("/api/donations", status_code=201)
def donate(payload: BloodRequest, user: User):
    require_role(user, "donor")
    return transact(user, "donation", payload.blood_type, payload.units)


@app.post("/api/inventory", status_code=201)
def adjust(payload: Adjustment, user: User):
    require_role(user, "manager")
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Please provide a reason of at least 3 characters.")
    return transact(user, "adjustment", payload.blood_type, payload.units, reason)


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        return FileResponse(STATIC_DIR / "favicon.svg")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")
