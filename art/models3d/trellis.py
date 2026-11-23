"""Image -> textured GLB via Microsoft's free TRELLIS.2 Hugging Face Space.

Usage:
  art/models3d/.venv/bin/python -I art/models3d/trellis.py <image> <out.glb> [--seed N] [--res 1024] [--faces 300000]

Set HF_TOKEN in the environment to use your own (free) ZeroGPU quota.
The image is uploaded to Hugging Face.
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--res", default="1024", choices=["512", "1024", "1536"])
    ap.add_argument("--faces", type=int, default=300000)
    ap.add_argument("--texture", type=int, default=2048)
    a = ap.parse_args()
    _load_env()

    client = Client("microsoft/TRELLIS.2", token=os.environ.get("HF_TOKEN"))
    client.predict(api_name="/start_session")
    prepped = client.predict(handle_file(a.image), api_name="/preprocess_image")
    print("preprocessed (background removed):", prepped)
    client.predict(handle_file(prepped), a.seed, a.res, api_name="/image_to_3d")
    print("generated; extracting GLB...")
    glb, _ = client.predict(a.faces, a.texture, api_name="/extract_glb")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    shutil.copy(glb, a.out)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
