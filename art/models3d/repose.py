"""Edit a reference image with the free FLUX.1 Kontext Hugging Face Space.

Usage:
  .venv/bin/python -I repose.py <image> <out.png> [--preset apose|staff|dragon] [--prompt "..."] [--seed N]

Presets turn a posed character sheet into inputs TRELLIS.2 handles well:
  apose  - the character alone, front view, A-pose, fingers spread, no props
  staff  - the staff alone, upright, plain background
  dragon - the small dragon alone, wings spread, plain background
The image is uploaded to Hugging Face. Set HF_TOKEN for your own free quota.
"""
import argparse
import os
import shutil

from gradio_client import Client, handle_file


def _load_env() -> None:
    """Read HF_TOKEN etc. from art/models3d/.env (gitignored) if present."""
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env):
        for line in open(env):
            k, _, v = line.strip().partition("=")
            if k and v and not k.startswith("#"):
                os.environ.setdefault(k, v.strip().strip('"'))

PRESETS = {
    "apose": (
        "Show the same woman standing straight, full body, facing the camera, "
        "in a symmetrical A-pose: arms straight and angled 45 degrees down away "
        "from the body, palms facing down, all five fingers spread apart, legs "
        "straight and slightly apart, feet flat. Remove the staff and the small "
        "dragon; her hands are empty. Her cape hangs straight down behind her "
        "back. Neutral expression, eyes forward. Keep her face, red hair, "
        "outfit, armour, belts, boots and colours exactly the same. Even soft "
        "lighting, plain light grey background, no shadow."
    ),
    "staff": (
        "Show only the wooden staff with the glowing claw head, alone, standing "
        "perfectly upright and centred, whole staff visible from end to end, "
        "no person, no flame, plain light grey background, even lighting."
    ),
    "dragon": (
        "Show only the small red dragon, alone, full body, standing on all four "
        "legs facing the camera, wings spread, tail visible, no person, plain "
        "light grey background, even lighting."
    ),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--preset", choices=sorted(PRESETS), default="apose")
    ap.add_argument("--prompt")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--guidance", type=float, default=2.5)
    ap.add_argument("--steps", type=int, default=28)
    a = ap.parse_args()
    _load_env()

    prompt = a.prompt or PRESETS[a.preset]
    client = Client("black-forest-labs/FLUX.1-Kontext-Dev", token=os.environ.get("HF_TOKEN"))
    result, seed = client.predict(
        handle_file(a.image), prompt, a.seed, a.seed == 0, a.guidance, a.steps,
        api_name="/infer",
    )
    path = result["path"] if isinstance(result, dict) else result
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    shutil.copy(path, a.out)
    print(f"wrote {a.out} (seed {int(seed)})")


if __name__ == "__main__":
    main()
