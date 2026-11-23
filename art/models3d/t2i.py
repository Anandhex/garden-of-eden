"""Text -> image with the free FLUX.1 [schnell] Hugging Face Space (Apache-2.0 model; outputs usable in the game).

Usage:
  .venv/bin/python -I t2i.py <out.png> --prompt "..." [--seed N] [--w 768] [--h 1344] [--steps 4]
  .venv/bin/python -I t2i.py <out_dir> --design woman|man --seeds 1,2,3     (our character design prompts below)

The prompt is sent to Hugging Face. Set HF_TOKEN (art/models3d/.env, gitignored) for your own free quota.
"""
import argparse
import os
import shutil

from gradio_client import Client


def _load_env() -> None:
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env):
        for line in open(env):
            k, _, v = line.strip().partition("=")
            if k and v and not k.startswith("#"):
                os.environ.setdefault(k, v.strip().strip('"'))


STYLE = (
    "stylized 3D character render in the style of a modern animated feature film, soft smooth matte skin, gentle "
    "subsurface glow, soft studio lighting, clean plain light grey background, full body, front view, symmetrical "
    "A-pose: arms straight and angled 45 degrees down away from the body, hands open with fingers spread apart, legs "
    "straight and slightly apart, bare feet flat, neutral calm expression, eyes looking at the camera, plain seamless "
    "skin-tight light grey neutral bodysuit covering the body, no logos, no accessories, no props"
)
DESIGNS = {
    "woman": (
        "a young adult woman, slim but healthy figure, long legs, small head, about 8 heads tall, softly rounded cheeks, "
        "small delicate chin, slim long straight nose with a small slightly upturned tip, almond-shaped eyes of normal "
        "size with a heavy upper eyelid and a thin dark eyeliner line, natural soft brows, wide lips of moderate "
        "fullness, small ears, dark brown hair pulled back tightly into a small low bun so the skull shape shows, "
        + STYLE
    ),
    "man": (
        "a handsome young adult man, athletic lean figure, broad shoulders, long legs, small head, about 8 heads tall, "
        "defined slightly angular jaw and chin, visible cheekbones, no puffiness, straight slim nose, almond-shaped eyes "
        "of normal size set in the sockets under a calm brow, natural full eyebrows, thin natural lips, small ears, "
        "short neat dark brown hair close to the head so the skull shape shows, clean shaven, "
        + STYLE
    ),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--prompt")
    ap.add_argument("--design", choices=sorted(DESIGNS))
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--seeds")
    ap.add_argument("--w", type=int, default=768)
    ap.add_argument("--h", type=int, default=1344)
    ap.add_argument("--steps", type=int, default=4)
    a = ap.parse_args()
    _load_env()
    prompt = a.prompt or DESIGNS[a.design]
    client = Client("black-forest-labs/FLUX.1-schnell", token=os.environ.get("HF_TOKEN"), verbose=False)
    seeds = [int(s) for s in a.seeds.split(",")] if a.seeds else [a.seed]
    for s in seeds:
        result, seed = client.predict(prompt, s, False, a.w, a.h, a.steps, api_name="/infer")
        path = result["path"] if isinstance(result, dict) else result
        out = a.out if not a.seeds else os.path.join(a.out, f"{a.design or 'img'}_s{s}.png")
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        shutil.copy(path, out)
        print("wrote", out, "seed", int(seed), flush=True)


if __name__ == "__main__":
    main()
