#!/bin/zsh
# refshot.sh name refid camx camy camz looky fov
S=/private/tmp/claude-501/-Users-anandpatil-Documents-Projects-web-game-llm-game/126289ba-23d2-455d-bbb4-08c96a41d5f1/scratchpad
cd /Users/anandpatil/Documents/Projects/web/game/llm-game/unity/GardenOfEden
P=$(sed -e "s/REFID/\"$2\"/" -e "s/CAMX/$3f/" -e "s/CAMY/$4f/" -e "s/CAMZ/$5f/" -e "s/LOOKY/$6f/" -e "s/FOV/$7f/" $S/person.cs.txt)
~/.unity/bin/unity command eval --timeout 120 --result-only --code "
var cam = UnityEngine.Camera.main; string info = \"\";
$(cat $S/stage.cs.txt)
$P
var rt = new UnityEngine.RenderTexture(1600, 900, 24, UnityEngine.RenderTextureFormat.ARGB32);
var old = cam.targetTexture; cam.targetTexture = rt; cam.Render(); cam.targetTexture = old;
UnityEngine.RenderTexture.active = rt;
var tex = new UnityEngine.Texture2D(1600, 900, UnityEngine.TextureFormat.RGB24, false);
tex.ReadPixels(new UnityEngine.Rect(0,0,1600,900),0,0); tex.Apply();
UnityEngine.RenderTexture.active = null;
System.IO.File.WriteAllBytes(\"$S/$1.png\", tex.EncodeToPNG());
$(cat $S/restore.cs.txt)
return info;" 2>&1 | grep -E '"result"|rror|message' | head -8
