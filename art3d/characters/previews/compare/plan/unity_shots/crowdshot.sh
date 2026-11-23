#!/bin/zsh
# crowdshot.sh name radius dist height looky fov
S=/private/tmp/claude-501/-Users-anandpatil-Documents-Projects-web-game-llm-game/126289ba-23d2-455d-bbb4-08c96a41d5f1/scratchpad
cd /Users/anandpatil/Documents/Projects/web/game/llm-game/unity/GardenOfEden
P=$(sed -e "s/RAD/${2}f/g" -e "s/DIST/$3f/" -e "s/HGT/$4f/" -e "s/LOOKY/$5f/" -e "s/FOV/$6f/" $S/crowdcam.cs.txt)
~/.unity/bin/unity command eval --timeout 120 --result-only --code "
var cam = UnityEngine.Camera.main; string info = \"\";
$P
var rt = new UnityEngine.RenderTexture(1600, 900, 24, UnityEngine.RenderTextureFormat.ARGB32);
var old = cam.targetTexture; cam.targetTexture = rt; cam.Render(); cam.targetTexture = old;
UnityEngine.RenderTexture.active = rt;
var tex = new UnityEngine.Texture2D(1600, 900, UnityEngine.TextureFormat.RGB24, false);
tex.ReadPixels(new UnityEngine.Rect(0,0,1600,900),0,0); tex.Apply();
UnityEngine.RenderTexture.active = null;
System.IO.File.WriteAllBytes(\"$S/$1.png\", tex.EncodeToPNG());
cam.transform.position = cpos; cam.transform.rotation = crot; cam.fieldOfView = cfov;
return info;" 2>&1 | grep -E '"result"|rror|message' | head -8
