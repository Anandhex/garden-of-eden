# Source this to run Blender with the project-local MPFB install (see mh/README.md).
HERE_MH="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export BLENDER_USER_RESOURCES="$HERE_MH/../tools/blender_user"
export B=/Applications/Blender.app/Contents/MacOS/Blender
