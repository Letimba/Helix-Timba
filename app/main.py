from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse

from .api import router
from .config import EnvSettings, load_config
from .engine import Engine
from .storage import Store

BASE = Path(__file__).resolve().parent.parent


def build_app() -> FastAPI:
    env = EnvSettings()
    cfg_path = BASE / "helix.config.json"
    cfg = load_config(cfg_path, env)
    db_path = Path(env.db_path).expanduser() if env.db_path else BASE / "helix.db"
    store = Store(db_path)
    engine = Engine(cfg, cfg_path, store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await engine.start()
        try:
            yield
        finally:
            await engine.stop()

    app = FastAPI(title="HELIX V5.3.1 Industrial", version="5.3.1", lifespan=lifespan)
    app.include_router(router(engine, BASE / "frontend" / "index.html"))

    @app.get("/ui.css")
    async def ui_css():
        return FileResponse(BASE / "frontend" / "ui.css", media_type="text/css")

    @app.get("/ui.js")
    async def ui_js():
        return FileResponse(BASE / "frontend" / "ui.js", media_type="application/javascript")

    app.state.engine = engine
    return app


app = build_app()


if __name__ == "__main__":
    env = EnvSettings()
    uvicorn.run(app, host=env.host, port=env.port, reload=False, log_level="info")
