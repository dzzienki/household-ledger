from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Ledger, LedgerMember, LedgerRole, Tag
from app.schemas.tag import TagCreate, TagPublic, TagUpdate

router = APIRouter(prefix="/ledgers/{ledger_id}/tags", tags=["tags"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


@router.get("", response_model=list[TagPublic])
async def list_tags(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[Tag]:
    ledger, _ = membership
    stmt = select(Tag).where(Tag.ledger_id == ledger.id).order_by(Tag.name)
    return list((await db.exec(stmt)).all())


@router.post("", response_model=TagPublic, status_code=status.HTTP_201_CREATED)
async def create_tag(
    payload: TagCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Tag:
    ledger, _ = membership
    existing = (
        await db.exec(
            select(Tag).where(Tag.ledger_id == ledger.id, Tag.name == payload.name)
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Tag with this name already exists")

    tag = Tag(ledger_id=ledger.id, **payload.model_dump())
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.patch("/{tag_id}", response_model=TagPublic)
async def update_tag(
    tag_id: UUID,
    payload: TagUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Tag:
    ledger, _ = membership
    tag = await db.get(Tag, tag_id)
    if tag is None or tag.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Tag not found")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != tag.name:
        clash = (
            await db.exec(
                select(Tag).where(Tag.ledger_id == ledger.id, Tag.name == data["name"])
            )
        ).first()
        if clash is not None:
            raise HTTPException(status_code=400, detail="Tag with this name already exists")

    for key, value in data.items():
        setattr(tag, key, value)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    tag = await db.get(Tag, tag_id)
    if tag is None or tag.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()
