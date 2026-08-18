from fastapi import FastAPI

app = FastAPI(title="Fantasy Draft Assistant")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
