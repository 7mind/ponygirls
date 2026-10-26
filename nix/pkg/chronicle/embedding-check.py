"""Specified-origin package contract checks; offline, no CUDA allocation."""
import importlib.metadata
import json
import hashlib
import os
from pathlib import Path
import sys
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

roots = (Path(sys.prefix) / "share/chronicle-embedding/requirements.in").read_text()
pending = [Requirement(line) for line in roots.splitlines() if line and not line.startswith("#")]
visited = set()
environment = default_environment()
while pending:
    requirement = pending.pop()
    distribution = importlib.metadata.distribution(requirement.name)
    assert requirement.specifier.contains(distribution.version), (str(requirement), distribution.version)
    contexts = {"", *requirement.extras}
    for extra in contexts:
        key = (canonicalize_name(requirement.name), extra)
        if key in visited:
            continue
        visited.add(key)
        for raw in distribution.requires or []:
            dependency = Requirement(raw)
            if dependency.marker is None or dependency.marker.evaluate({**environment, "extra": extra}):
                pending.append(dependency)
print(f"Validated {len(visited)} distribution/extra contexts from installed wheel metadata")

expected = json.loads((Path(sys.prefix) / "share/chronicle-embedding/wheels.json").read_text())
constraints = (Path(sys.prefix) / "share/chronicle-embedding/reference-constraints.txt").read_text()
reference = {canonicalize_name(requirement.name): requirement
             for line in constraints.splitlines() if line and not line.startswith("#")
             for requirement in [Requirement(line)]}
allowed_deviations = {"pyjwt": "2.15.1", "nvidia-nccl-cu13": "2.29.7"}
for wheel in expected:
    name = canonicalize_name(wheel["name"])
    actual = importlib.metadata.version(wheel["name"])
    assert actual == wheel["version"], (wheel["name"], actual, wheel["version"])
    if name in allowed_deviations:
        assert actual == allowed_deviations[name], (name, actual)
    else:
        assert name in reference, ("Unreviewed reference deviation", name)
        assert reference[name].specifier.contains(actual, prereleases=True), (name, actual, str(reference[name]))
import torch
import transformers
import vllm
import torchvision
import torchaudio
import torchcodec
from torchcodec._core import ffmpeg_major_version, get_ffmpeg_library_versions

assert torchvision.__version__ == "0.28.0+cu130", torchvision.__version__
assert torchaudio.__version__ == "2.11.0+cu130", torchaudio.__version__
assert ffmpeg_major_version == 8, ffmpeg_major_version
print(json.dumps({"torchcodec_ffmpeg_libraries": get_ffmpeg_library_versions()}))
from vllm.model_executor.models import ModelRegistry

assert torch.__version__.split("+")[0] == "2.13.0", torch.__version__
assert torch.version.cuda == "13.0", torch.version.cuda
assert transformers.__version__ == "5.19.0"
assert vllm.__version__ == "0.32.0"
assert "EmbeddingGemma2Model" in ModelRegistry.get_supported_archs()
backend_hash = hashlib.sha256((Path(sys.prefix) / "lib/python3.12/site-packages/build_backend.py").read_bytes()).hexdigest()
assert backend_hash == "e02446b7d8276825d5761b209f46d39ea09c4a5e9db7e97dc641654f3cae6317", backend_hash
import triton
import tokenspeed_triton

for implementation in (triton, tokenspeed_triton):
    tool = implementation.knobs.nvidia.ptxas
    assert tool.path == os.environ["TRITON_PTXAS_PATH"], tool
    assert tool.version == "13.4", tool
print(json.dumps({"ptxas": tool.path, "build_backend_sha256": backend_hash}))
print(json.dumps({"python": sys.version, "torch": torch.__version__,
                  "cuda": torch.version.cuda, "transformers": transformers.__version__,
                  "vllm": vllm.__version__, "embedding_gemma2_registered": True}))
