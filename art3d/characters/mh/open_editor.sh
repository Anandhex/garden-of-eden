#!/bin/bash
# Opens the Garden of Eden character editor: Blender with editor.blend, the project-local MakeHuman (MPFB) install and
# the "Garden of Eden" side panel (press N in the 3D view if the side bar is hidden).  Guide: EDITING.md
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/mpfb_env.sh"
if [ ! -f "$HERE/editor.blend" ]; then
  echo "editor.blend is missing: build it with"
  echo "  $B -b \"$HERE/base_mh.blend\" -P \"$HERE/make_editor.py\""
  exit 1
fi
# --python-use-system-env is not needed; the panel script adds mh/ to the path itself
exec "$B" "$HERE/editor.blend" --python "$HERE/editor_panel.py" "$@"
