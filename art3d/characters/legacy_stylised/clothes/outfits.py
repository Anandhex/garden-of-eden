"""Outfit sets: complete mixes of pieces per class and culture (architecture-style flavour).  Colours are suggestions for
look.tint / look.trim (the server's look overrides them)."""
B = None

def O(oid, name, cls, culture, pieces, tint, trim, sex="any", age="adult", note=""):
    return dict(id=oid, name=name, class_=cls, culture=culture, pieces=pieces, tint=tint, trim=trim, sex=sex, age=age, note=note)

OUTFITS = [
 O("farmer_highland_m", "Highland farmer", "farmer", "highland", ["t_shirt", "a_sleeve_long", "s_kilt", "o_belt", "o_pouch", "f_boots_short", "t_vest_fur", "hw_cap_soft", "h_mittens"], "#6b6f4a", "#8a3b2e", "masculine"),
 O("farmer_river_f", "River farmwife", "farmer", "river", ["t_bodice", "a_sleeve_short", "s_skirt_long", "o_apron", "f_shoes", "hw_straw_hat"], "#7a6a4a", "#b08a3a", "feminine"),
 O("farmer_coastal_m", "Coastal fisher-farmer", "farmer", "coastal", ["t_jersey", "a_sleeve_short", "l_breeches", "l_leg_wraps", "f_wraps", "hw_skullcap", "o_belt"], "#4a5a6a", "#d8d0b8", "masculine"),
 O("farmer_forest_m", "Forest homesteader", "farmer", "forest", ["t_jerkin", "t_shirt", "a_sleeve_long", "l_trousers", "f_boots_short", "o_belt", "o_hood", "h_gloves"], "#5a6a48", "#8a5a30"),
 O("labourer_river_m", "River labourer", "labourer", "river", ["t_shirt", "a_sleeve_rolled", "l_trousers", "o_apron", "f_boots_short", "o_belt", "hw_cap_soft", "a_bracer"], "#8a7a5a", "#5a4630", "masculine"),
 O("labourer_steppe_m", "Steppe herder", "labourer", "steppe", ["t_deel", "a_sleeve_long", "l_baggy", "f_boots_short", "o_belt_sash", "hw_fur_cone", "h_mittens"], "#6a4a3a", "#c0903a", "masculine"),
 O("labourer_coastal_f", "Coastal net-mender", "labourer", "coastal", ["t_jersey", "a_sleeve_short", "s_skirt_short", "f_wraps", "o_belt", "o_scarf"], "#5a6a70", "#c8c0a8", "feminine"),
 O("smith_highland_m", "Highland smith", "smith", "highland", ["t_shirt", "a_sleeve_short", "l_trousers", "o_apron", "h_gloves", "a_bracer", "f_boots_short", "o_belt"], "#74634a", "#4a3a2a", "masculine"),
 O("smith_imperial_m", "Imperial armourer", "smith", "imperial", ["t_clavus", "a_sleeve_short", "l_leggings", "o_apron", "h_gloves", "f_shoes", "o_belt", "a_bracer"], "#8a6a4a", "#7a2a28", "masculine"),
 O("merchant_river_m", "River merchant", "merchant", "river", ["t_doublet", "a_sleeve_fitted", "l_trousers", "f_boots_short", "o_belt", "o_pouch", "hw_cap_soft", "o_scarf"], "#3a4a6a", "#c0a050", "masculine"),
 O("merchant_coastal_f", "Coastal trader", "merchant", "coastal", ["t_shirt_open", "a_sleeve_puffed", "l_breeches", "f_shoes", "o_belt_sash", "o_pouch", "hw_turban", "t_vest_quilted"], "#8a4a3a", "#d8b048", "feminine"),
 O("merchant_steppe_m", "Caravan merchant", "merchant", "steppe", ["t_deel", "a_sleeve_long", "l_baggy", "f_boots_tall", "o_belt_sash", "o_pouch", "hw_fur_cone", "o_collar_fur"], "#3a5a6a", "#c0903a", "masculine"),
 O("noble_imperial_m", "Imperial patrician", "noble", "imperial", ["t_clavus", "a_sleeve_long", "l_leggings", "f_boots_tall", "o_toga_drape", "hw_circlet"], "#a89878", "#6a1f2a", "masculine"),
 O("noble_imperial_f", "Imperial lady", "noble", "imperial", ["t_bodice", "a_sleeve_puffed", "s_dress_skirt", "o_belt_sash", "hw_circlet", "f_shoes"], "#5a3a52", "#c8a048", "feminine"),
 O("noble_river_m", "River lord", "noble", "river", ["t_doublet", "a_sleeve_puffed", "l_leggings", "f_boots_tall", "o_cape_short", "o_belt", "hw_cap_soft", "h_gloves"], "#2f3a5a", "#c0a050", "masculine"),
 O("noble_highland_f", "Highland chieftainess", "noble", "highland", ["t_bodice", "a_sleeve_wide", "s_dress_skirt", "o_cloak_long", "o_belt", "f_shoes", "o_collar_fur"], "#4a5a48", "#8a3b2e", "feminine"),
 O("noble_steppe_m", "Steppe khan", "noble", "steppe", ["t_deel", "a_sleeve_long", "l_baggy", "f_boots_tall", "o_cape_short", "o_collar_fur", "hw_fur_cone", "o_belt_sash", "h_gloves"], "#7a2f2a", "#d0a040", "masculine"),
 O("priest_imperial_m", "Imperial priest", "priest", "imperial", ["t_robe_top", "a_sleeve_wide", "s_robe_lower", "o_belt_sash", "f_sandals", "hw_skullcap"], "#d0c8b0", "#8a2a30"),
 O("priest_forest_f", "Forest druid", "priest", "forest", ["t_robe_top", "a_sleeve_long", "s_robe_lower", "o_hood", "o_belt", "f_wraps"], "#5a6a44", "#a88a3a", "feminine"),
 O("guard_imperial_m", "Imperial guard", "guard", "imperial", ["t_shirt", "t_breastplate", "a_sleeve_fitted", "a_pauldron", "a_vambrace", "l_trousers", "l_greaves", "f_boots_tall", "h_gauntlets", "o_belt", "o_tabard", "hw_helm_open"], "#7a2a2a", "#c8a048", "masculine"),
 O("guard_highland_m", "Highland warden", "guard", "highland", ["t_mail", "a_mail", "s_kilt", "o_belt", "o_cloak_long", "f_boots_short", "h_gloves", "hw_coif"], "#4a5a6a", "#8a3b2e", "masculine"),
 O("soldier_steppe_m", "Steppe horse-archer", "soldier", "steppe", ["t_deel", "t_breastplate", "a_sleeve_long", "a_vambrace", "l_baggy", "f_boots_tall", "o_bandolier", "hw_fur_cone", "h_gloves"], "#5a4a3a", "#b88a3a", "masculine"),
 O("soldier_river_f", "River militia", "soldier", "river", ["t_jerkin", "a_sleeve_fitted", "l_leggings", "f_boots_short", "o_belt", "o_pouch", "h_gloves", "hw_skullcap", "a_bracer"], "#4a5a48", "#8a6a3a", "feminine"),
 O("scholar_imperial_m", "Imperial scholar", "scholar", "imperial", ["t_robe_top", "a_sleeve_wide", "s_robe_lower", "o_belt", "o_satchel", "f_shoes", "hw_skullcap"], "#3a4a5a", "#c8a048"),
 O("scholar_river_f", "River scribe", "scholar", "river", ["t_doublet", "a_sleeve_fitted", "l_trousers", "o_scarf", "o_satchel", "f_shoes", "hw_cap_soft"], "#5a3a3a", "#c0a050", "feminine"),
 O("traveller_forest_m", "Forest ranger", "traveller", "forest", ["t_jerkin", "a_sleeve_long", "l_trousers", "f_boots_tall", "o_cloak_long", "o_belt", "o_pouch", "h_gloves", "a_bracer", "o_bandolier"], "#566a46", "#8a5a30", "masculine"),
 O("traveller_coastal_f", "Coastal wanderer", "traveller", "coastal", ["t_jersey", "a_sleeve_short", "l_breeches", "f_boots_short", "o_cape_short", "o_satchel", "hw_straw_hat", "o_scarf"], "#4a6a70", "#d8c8a0", "feminine"),
 O("child_river", "River child", "child", "river", ["t_shirt", "a_sleeve_short", "l_shorts", "f_shoes", "o_belt", "hw_cap_soft"], "#8a7a5a", "#7a4a30", age="child"),
 O("child_highland_f", "Highland girl", "child", "highland", ["t_bodice", "a_sleeve_short", "s_skirt_short", "f_boots_short", "o_scarf"], "#6a4a52", "#c0a050", "feminine", "child"),
 O("elder_forest_m", "Forest elder", "elder", "forest", ["t_shirt_open", "a_sleeve_long", "l_trousers", "o_cloak_long", "o_scarf", "f_wraps", "o_belt", "hw_skullcap", "t_vest_fur"], "#6a6a58", "#8a5a30", "masculine", "elder"),
 O("elder_coastal_f", "Coastal grandmother", "elder", "coastal", ["t_bodice", "a_sleeve_long", "s_skirt_long", "o_apron", "o_scarf", "f_shoes", "hw_skullcap"], "#5a6a6a", "#c8c0a8", "feminine", "elder"),
 O("slave_ragged_m", "Ragged bondsman", "slave", "any", ["t_rags", "a_rags", "l_rags", "f_wraps", "h_wraps"], "#8a7c62", "#6a5a44", "masculine"),
 O("slave_ragged_f", "Ragged bondswoman", "slave", "any", ["t_rags", "a_rags", "s_skirt_short", "l_leg_wraps"], "#80745c", "#6a5a44", "feminine"),
]
