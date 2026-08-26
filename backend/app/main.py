from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.draft import router as draft_router
from app.api.league import router as league_router
from app.api.players import router as players_router
from app.api.rank_datasets import router as rank_datasets_router
from app.api.ranks import router as ranks_router
from app.api.sync import router as sync_router

# NOTE: the schema is owned by Alembic (backend/alembic/), not by
# create_all(). Importing this module used to call Base.metadata.create_all(),
# which would happily create tables behind Alembic's back -- a later
# `alembic upgrade head` then finds them already present and its CREATE TABLE
# fails. Run `alembic upgrade head` to build or migrate the database.

app = FastAPI(title="Fantasy Draft Assistant")

# Local-only app: frontend and backend run as separate dev servers on localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(players_router)
app.include_router(sync_router)
app.include_router(ranks_router)
app.include_router(rank_datasets_router)
app.include_router(draft_router)
app.include_router(league_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
