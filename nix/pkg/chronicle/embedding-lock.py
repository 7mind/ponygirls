"""Select public PyPI wheels for an already resolved CPython 3.12 Linux graph.

Usage: python embedding-lock.py pins.txt > embedding-wheels.json
Requires packaging. Does not download wheel bodies or execute package code.
"""
import concurrent.futures
import json
import sys
import urllib.request
from packaging.tags import cpython_tags, compatible_tags
from packaging.specifiers import SpecifierSet
from packaging.utils import parse_wheel_filename

platforms = [f"manylinux_2_{v}_x86_64" for v in range(39, 4, -1)]
platforms += ["manylinux2014_x86_64", "manylinux2010_x86_64", "manylinux1_x86_64", "linux_x86_64"]
tags = list(cpython_tags((3, 12), platforms=platforms))
tags += list(compatible_tags((3, 12), interpreter="cp312", platforms=platforms))
priority = {tag: index for index, tag in reversed(list(enumerate(tags)))}


def select(pin):
    name, version = pin.strip().split("==")
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json", timeout=60) as response:
        metadata = json.load(response)
    candidates = []
    for wheel in metadata["urls"]:
        if wheel["packagetype"] != "bdist_wheel" or wheel["yanked"]:
            continue
        if not SpecifierSet(wheel["requires_python"] or "").contains("3.12.15"):
            continue
        wheel_tags = parse_wheel_filename(wheel["filename"])[3]
        ranks = [priority[tag] for tag in wheel_tags if tag in priority]
        if ranks:
            candidates.append((min(ranks), wheel["filename"], wheel))
    if not candidates:
        raise ValueError(f"No compatible wheel: {pin}")
    wheel = min(candidates)[2]
    assert wheel["url"].startswith("https://files.pythonhosted.org/")
    return {"name": name, "version": version, "filename": wheel["filename"],
            "url": wheel["url"], "sha256": wheel["digests"]["sha256"],
            "size": wheel["size"], "requires_dist": metadata["info"]["requires_dist"] or []}


if __name__ == "__main__":
    with open(sys.argv[1]) as source:
        pins = [line.strip() for line in source if line.strip() and not line.startswith("#")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        wheels = list(executor.map(select, pins))
    json.dump(wheels, sys.stdout, indent=2)
    print()
