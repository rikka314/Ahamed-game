#!/usr/bin/env python3
"""Run one traceable Seedream image-generation smoke test.

The API key is read only from ARK_API_KEY and is never written to disk or logs.
Generated files default to the ignored game/test-results directory so a smoke test
cannot accidentally become an approved runtime asset.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL = "doubao-seedream-5-0-pro-260628"
DEFAULT_PROMPT = (
    "Orthographic top-down pixel-art direction candidate for a compact warm morning "
    "community clinic. Clear left entrance and patient queue, central doctor "
    "consultation desk, right curtained blood-pressure examination area, nearby "
    "clinical drawer, and readable upper and lower locked zones. Hard pixel edges, "
    "consistent scale, calm cream and sage palette, no people, no text, no logo, "
    "no watermark, no isometric perspective, no diagnosis information."
)
DEFAULT_OUTPUT = "test-results/seedream/clinic-direction-draft"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate and download one Seedream DRAFT image without exposing the API key."
    )
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--size", default="2K")
    parser.add_argument("--base-url", default=ARK_BASE_URL)
    parser.add_argument("--output", type=Path, default=Path(DEFAULT_OUTPUT))
    parser.add_argument("--asset-id", default="tileset.clinic.community-01")
    parser.add_argument(
        "--watermark",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Add the provider watermark. Disabled for project DRAFT review files.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate configuration without making a billable API request.",
    )
    return parser.parse_args()


def game_root() -> Path:
    return Path(__file__).resolve().parents[1]


def resolve_prompt(args: argparse.Namespace) -> str:
    if args.prompt_file is None:
        prompt = args.prompt
    else:
        prompt_path = args.prompt_file
        if not prompt_path.is_absolute():
            prompt_path = game_root() / prompt_path
        prompt = prompt_path.read_text(encoding="utf-8")

    prompt = prompt.strip()
    if not prompt:
        raise ValueError("Prompt must not be empty.")
    return prompt


def resolve_output_base(output: Path) -> Path:
    resolved = output if output.is_absolute() else game_root() / output
    return resolved.with_suffix("") if resolved.suffix else resolved


def request_summary(args: argparse.Namespace, prompt: str, output_base: Path) -> dict[str, Any]:
    return {
        "assetId": args.asset_id,
        "status": "DRAFT",
        "baseUrl": args.base_url,
        "model": args.model,
        "size": args.size,
        "watermark": args.watermark,
        "prompt": prompt,
        "outputBase": str(output_base),
    }


def require_api_key() -> str:
    api_key = os.environ.get("ARK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "ARK_API_KEY is not set in this terminal. Set it locally; do not paste it into chat."
        )
    return api_key


def image_suffix(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return ".webp"
    raise RuntimeError("Seedream returned an unsupported or invalid image payload.")


def download_image(url: str) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("Seedream returned a non-HTTPS image URL; refusing to download it.")
    request = Request(url, headers={"User-Agent": "AhaMed-Seedream-Smoke/1.0"})
    with urlopen(request, timeout=120) as response:  # noqa: S310 - trusted provider URL
        return response.read()


def model_dump(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)


def write_provenance(
    path: Path,
    *,
    args: argparse.Namespace,
    prompt: str,
    response: Any,
    image_path: Path,
) -> None:
    image_item = response.data[0]
    provenance = {
        "assetId": args.asset_id,
        "sourceType": "ai-assisted",
        "author": "AhaMed project DRAFT",
        "sourceUrl": None,
        "license": None,
        "commercialUse": None,
        "modificationAllowed": None,
        "redistributionNotes": (
            "Verify the Seedream service terms applicable on the generation date before release."
        ),
        "generator": "Volcano Engine Ark Images API",
        "modelVersion": args.model,
        "generatedAt": datetime.now(UTC).isoformat(),
        "prompt": prompt,
        "humanEdits": [],
        "status": "DRAFT",
        "request": {
            "baseUrl": args.base_url,
            "size": args.size,
            "watermark": args.watermark,
            "responseFormat": "url",
        },
        "response": {
            "model": getattr(response, "model", None),
            "created": getattr(response, "created", None),
            "size": getattr(image_item, "size", None),
            "usage": model_dump(getattr(response, "usage", None)),
        },
        "file": str(image_path.relative_to(game_root())),
    }
    path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    try:
        prompt = resolve_prompt(args)
        output_base = resolve_output_base(args.output)
        summary = request_summary(args, prompt, output_base)

        if args.dry_run:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            print("Dry run passed; no API request was made.")
            return 0

        api_key = require_api_key()
        try:
            from openai import OpenAI
        except ImportError as error:
            raise RuntimeError(
                "The 'openai' package is not installed in this Python environment."
            ) from error

        client = OpenAI(base_url=args.base_url, api_key=api_key)
        response = client.images.generate(
            model=args.model,
            prompt=prompt,
            size=args.size,
            response_format="url",
            extra_body={"watermark": args.watermark},
        )
        if not response.data or not response.data[0].url:
            raise RuntimeError("Seedream returned no downloadable image URL.")

        image_bytes = download_image(response.data[0].url)
        output_base.parent.mkdir(parents=True, exist_ok=True)
        image_path = output_base.with_suffix(image_suffix(image_bytes))
        image_path.write_bytes(image_bytes)
        provenance_path = output_base.with_suffix(".provenance.json")
        write_provenance(
            provenance_path,
            args=args,
            prompt=prompt,
            response=response,
            image_path=image_path,
        )

        print(f"Seedream API call succeeded: {image_path}")
        print(f"DRAFT provenance saved: {provenance_path}")
        return 0
    except Exception as error:  # concise CLI boundary; preserves no secrets
        print(f"Seedream smoke failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
