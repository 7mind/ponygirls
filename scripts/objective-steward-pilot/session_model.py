"""Bounded model transport for the longitudinal profile; no source ingestion or tools."""
import asyncio
from dataclasses import dataclass
import os
from pathlib import Path
import signal

from profile import Rejected, canonical, decode, fields
from session_profile import SYSTEM, Snapshot
from run import HARD_DEADLINE_SECONDS, MAX_BRIDGE_BYTES, write_json

HERE = Path(__file__).resolve().parent

@dataclass(frozen=True)
class SessionModelConfig:
    node: str
    sdk: str
    provider: str
    model: str
    thinking: str

class SessionModel:
    def __init__(self, config: SessionModelConfig, directory: Path):
        self.config = config
        self.directory = directory
        self.started = False

    async def review(self, snapshot: Snapshot) -> bytes:
        if self.started:
            raise Rejected("checkpoint cannot be retried")
        self.started = True
        payload = {"system": SYSTEM, "input": snapshot.wire()}
        write_json(self.directory / "request.json", payload)
        config = self.config
        process = await asyncio.create_subprocess_exec(config.node, str(HERE / "live.mjs"), "--sdk", config.sdk,
                    "--provider", config.provider, "--model", config.model, "--thinking", config.thinking,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    start_new_session=True)
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(canonical(payload)), HARD_DEADLINE_SECONDS)
        except BaseException:
            if process.returncode is None:
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
            write_json(self.directory / "bridge-failure.json", {"category": "deadline-or-cancel", "exit": process.returncode})
            raise
        if len(stdout) > MAX_BRIDGE_BYTES or len(stderr) > MAX_BRIDGE_BYTES:
            raise Rejected("bridge byte bound")
        if process.returncode != 0:
            category = stderr.decode("utf-8", errors="replace").strip()
            known = {"arguments", "input-limit", "input-json", "input-shape", "sdk-pin", "model-unavailable", "not-authenticated", "deadline", "stream-limit", "output-limit", "tool-call", "runtime-error", "provider-error", "incomplete-response", "stream-protocol", "model-change"}
            safe = category if category in known else "bridge-error"
            write_json(self.directory / "bridge-failure.json", {"category": safe, "exit": process.returncode})
            raise Rejected(safe)
        result = fields(decode(stdout, MAX_BRIDGE_BYTES), {"text", "usage", "provider", "model", "thinking"})
        if (result["provider"], result["model"], result["thinking"]) != (config.provider, config.model, config.thinking) or type(result["text"]) is not str:
            raise Rejected("unexpected model selection")
        write_json(self.directory / "response.json", result)
        return result["text"].encode("utf-8")
