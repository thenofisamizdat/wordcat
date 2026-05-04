from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def issue_token(payload: dict) -> str:
    now = datetime.now(timezone.utc)
    body = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_ttl_hours)).timestamp()),
    }
    return jwt.encode(body, settings.jwt_secret, algorithm=settings.jwt_alg)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


def issue_user_token(user: User) -> str:
    return issue_token({"sub": f"user:{user.id}", "name": user.display_name})


def issue_guest_token(display_name: str) -> tuple[str, str]:
    """Returns (token, guest_key). guest_key is a stable per-token identifier so daily-mode
    uniqueness can be enforced for guests as well."""
    guest_key = secrets.token_urlsafe(16)
    token = issue_token({"sub": f"guest:{guest_key}", "name": display_name})
    return token, guest_key


class Identity:
    def __init__(self, *, user: Optional[User], guest_key: Optional[str], display_name: str):
        self.user = user
        self.guest_key = guest_key
        self.display_name = display_name

    @property
    def is_guest(self) -> bool:
        return self.user is None

    @property
    def stable_key(self) -> str:
        if self.user:
            return f"user:{self.user.id}"
        return f"guest:{self.guest_key}"


def get_identity(
    authorization: Annotated[Optional[str], Header()] = None,
    db: Session = Depends(get_db),
) -> Identity:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    sub = payload.get("sub", "")
    name = payload.get("name", "")
    if sub.startswith("user:"):
        try:
            user_id = int(sub.split(":", 1)[1])
        except ValueError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad token")
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return Identity(user=user, guest_key=None, display_name=user.display_name)
    if sub.startswith("guest:"):
        guest_key = sub.split(":", 1)[1]
        return Identity(user=None, guest_key=guest_key, display_name=name or "Guest")
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad token subject")


def get_optional_identity(
    authorization: Annotated[Optional[str], Header()] = None,
    db: Session = Depends(get_db),
) -> Optional[Identity]:
    if not authorization:
        return None
    return get_identity(authorization=authorization, db=db)
