"""Each refresh re-walks the config home, picking up profile changes (BA)."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dummy_transport import ScriptedTransport
from tokemon.polling import make_query


def _add_profile(home: Path, name: str, provider: str) -> None:
    agent = home / ".config" / "yolo" / name / "pi" / "home" / "agent"
    agent.mkdir(parents=True)
    (agent / "models.json").write_text(json.dumps({"providers": {provider: {}}}), encoding="utf-8")


def _profiles(results) -> list[str]:
    return sorted(result.target.profile for result in results)


class RefreshTests(unittest.TestCase):
    def test_query_rediscovers_profiles_on_every_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            _add_profile(home, "alpha", "zai")
            query = make_query(home, {}, ScriptedTransport({}), lambda: datetime.now(timezone.utc))
            self.assertEqual(_profiles(query()), ["alpha"])

            _add_profile(home, "beta", "kimi-coding")
            self.assertEqual(_profiles(query()), ["alpha", "beta"])

            (home / ".config" / "yolo" / "alpha" / "pi" / "home" / "agent" / "models.json").unlink()
            self.assertEqual(_profiles(query()), ["beta"])


if __name__ == "__main__":
    unittest.main()
