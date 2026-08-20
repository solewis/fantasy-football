from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.draft import router as draft_router
from app.api.players import router as players_router
from app.api.ranks import router as ranks_router
from app.api.sync import router as sync_router
from app.db import Base, engine

# Idempotent: creates any tables that don't exist yet, leaves existing ones
# alone. Runs once per server process (including each --reload restart).
Base.metadata.create_all(engine)

app = FastAPI(title="Fantasy Draft Assistant")

# Local-only app: frontend and backend run as separate dev servers on localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(players_router)
app.include_router(sync_router)
app.include_router(ranks_router)
app.include_router(draft_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
