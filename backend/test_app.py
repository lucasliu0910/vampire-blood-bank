import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend import app as bank


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(bank, "DATA_DIR", tmp_path)
    bank.sessions.clear()
    bank.login_attempts.clear()
    bank.captchas.clear()
    with TestClient(bank.app) as client:
        yield client


def solve_captcha(client, correct=True):
    challenge = client.get("/api/captcha").json()
    answer = bank.captchas[challenge["id"]]["answer"]
    assert answer in challenge["options"] and len(challenge["options"]) == 4
    return {"captcha_id": challenge["id"], "captcha_answer": answer if correct else "Wrong on purpose"}


def sign_in(client, role):
    response = client.post("/api/login", json={"username": role, "password": f"{role.title()}123!", **solve_captcha(client)})
    assert response.status_code == 200
    assert "password" not in response.text
    assert "HttpOnly" in response.headers["set-cookie"]
    return response


def test_authentication_and_logout(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.post("/api/login", json={"username": "manager", "password": "wrong", **solve_captcha(client)}).status_code == 401
    sign_in(client, "manager")
    assert client.get("/api/me").json()["role"] == "manager"
    assert client.post("/api/logout").status_code == 204
    assert client.get("/api/me").status_code == 401
    users = json.loads((bank.DATA_DIR / "users.json").read_text())
    assert all(u["password_hash"].startswith("pbkdf2_sha256$") for u in users)
    assert "Manager123!" not in (bank.DATA_DIR / "users.json").read_text()


def test_donate_order_and_visibility(client):
    sign_in(client, "donor")
    before = client.get("/api/dashboard").json()["inventory"]["O-"]
    assert client.post("/api/donations", json={"blood_type": "O-", "units": 3}).status_code == 201
    assert client.post("/api/orders", json={"blood_type": "O-", "units": 1}).status_code == 403
    sign_in(client, "vampire")
    assert client.get("/api/dashboard").json()["transactions"] == []
    assert client.post("/api/orders", json={"blood_type": "O-", "units": 2}).status_code == 201
    data = client.get("/api/dashboard").json()
    assert data["inventory"]["O-"] == before + 1
    assert [t["kind"] for t in data["transactions"]] == ["order"]
    assert client.post("/api/donations", json={"blood_type": "O-", "units": 1}).status_code == 403
    assert client.post("/api/inventory", json={"blood_type": "O-", "units": 0, "reason": "test"}).status_code == 403
    sign_in(client, "manager")
    assert len(client.get("/api/dashboard").json()["transactions"]) == 2
    assert client.post("/api/inventory", json={"blood_type": "AB-", "units": 0, "reason": "Reconciliation"}).status_code == 201
    sign_in(client, "vampire")
    snapshot = (bank.DATA_DIR / "bank.json").read_text()
    assert client.post("/api/orders", json={"blood_type": "AB-", "units": 1}).status_code == 409
    assert (bank.DATA_DIR / "bank.json").read_text() == snapshot


@pytest.mark.parametrize("payload", [
    {"blood_type": "X", "units": 1},
    {"blood_type": "A+", "units": 0},
    {"blood_type": "A+", "units": -1},
    {"blood_type": "A+", "units": 101},
    {"blood_type": "A+", "units": 1.5},
    {"blood_type": "A+", "units": True},
    {"blood_type": "A+", "units": "2"},
])
def test_invalid_quantities_do_not_change_state(client, payload):
    sign_in(client, "donor")
    snapshot = (bank.DATA_DIR / "bank.json").read_text()
    assert client.post("/api/donations", json=payload).status_code == 422
    assert (bank.DATA_DIR / "bank.json").read_text() == snapshot


def test_capacity_and_reason(client):
    sign_in(client, "manager")
    assert client.post("/api/inventory", json={"blood_type": "A+", "units": 10000, "reason": "Stock count"}).status_code == 201
    assert client.post("/api/inventory", json={"blood_type": "A+", "units": 1, "reason": "   "}).status_code == 422
    sign_in(client, "donor")
    assert client.post("/api/donations", json={"blood_type": "A+", "units": 1}).status_code == 409


def test_persistence_and_session_expiration(client):
    sign_in(client, "donor")
    client.post("/api/donations", json={"blood_type": "B-", "units": 2})
    before = (bank.DATA_DIR / "bank.json").read_text()
    users = (bank.DATA_DIR / "users.json").read_text()
    bank.initialize_data()
    assert (bank.DATA_DIR / "bank.json").read_text() == before
    assert (bank.DATA_DIR / "users.json").read_text() == users
    for session in bank.sessions.values():
        session["expires"] = 0
    assert client.get("/api/me").status_code == 401


def test_concurrent_orders_cannot_oversell(client):
    sign_in(client, "manager")
    client.post("/api/inventory", json={"blood_type": "AB-", "units": 1, "reason": "Last bag"})
    sign_in(client, "vampire")
    token = client.cookies.get("blood_session")
    def order(_):
        with TestClient(bank.app) as other:
            other.cookies.set("blood_session", token)
            return other.post("/api/orders", json={"blood_type": "AB-", "units": 1}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(order, range(2))) == [201, 409]
    data = client.get("/api/dashboard").json()
    assert data["inventory"]["AB-"] == 0
    assert len(data["transactions"]) == 1


def test_cross_origin_and_login_throttle(client):
    assert client.post("/api/login", headers={"Origin": "https://elsewhere.example"}, json={"username": "manager", "password": "Manager123!"}).status_code == 403
    for _ in range(10):
        assert client.post("/api/login", json={"username": "nobody", "password": "wrong", **solve_captcha(client)}).status_code == 401
    assert client.post("/api/login", json={"username": "manager", "password": "Manager123!", **solve_captcha(client)}).status_code == 429

def test_vampire_captcha(client):
    creds = {"username": "vampire", "password": "Vampire123!"}
    # No captcha, a wrong answer, and an unknown challenge are all rejected before the password is checked.
    assert client.post("/api/login", json=creds).status_code == 422
    assert client.post("/api/login", json={**creds, **solve_captcha(client, correct=False)}).status_code == 400
    assert client.post("/api/login", json={**creds, "captcha_id": "nope", "captcha_answer": "Nothing at all"}).status_code == 400
    # A challenge is single use, even when the answer was right.
    solved = solve_captcha(client)
    assert client.post("/api/login", json={**creds, **solved}).status_code == 200
    assert client.post("/api/login", json={**creds, **solved}).status_code == 400
    # Expired challenges are refused.
    stale = solve_captcha(client)
    bank.captchas[stale["captcha_id"]]["expires"] = 0
    assert client.post("/api/login", json={**creds, **stale}).status_code == 400
