from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import (
    Identity,
    get_identity,
    hash_password,
    issue_guest_token,
    issue_user_token,
    verify_password,
)
from ..db import get_db
from ..models import User
from ..schemas import (
    GuestRequest,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    user = User(
        email=req.email.lower(),
        password_hash=hash_password(req.password),
        display_name=req.display_name.strip(),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    db.refresh(user)
    return TokenResponse(token=issue_user_token(user), display_name=user.display_name, is_guest=False)


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad credentials")
    return TokenResponse(token=issue_user_token(user), display_name=user.display_name, is_guest=False)


@router.post("/guest", response_model=TokenResponse)
def guest(req: GuestRequest):
    name = req.display_name.strip() or "Guest"
    token, _ = issue_guest_token(name)
    return TokenResponse(token=token, display_name=name, is_guest=True)


@router.get("/me", response_model=MeResponse)
def me(identity: Identity = Depends(get_identity)):
    return MeResponse(
        display_name=identity.display_name,
        is_guest=identity.is_guest,
        email=identity.user.email if identity.user else None,
    )
