# FH3-SatNavVoice

Ports the English TGT navigation voice pack v1.0.1 from FH2 to Forza Horizon 3 on **Azimuth**, using [FH3 Mod Platform v1.4.2](https://github.com/Levilente/FH3_ModPlatform/releases/tag/v1.4.2). Targets the Xbox One build with executable timestamp `0x5B16ECCA` and English speech. Not for the native Windows Store edition.

## Install

1. Install FH3 Mod Platform alongside `azimuth.exe` if it is not already installed. This mod does not bundle or replace the platform.
2. With Azimuth closed, remove any old `SatNavVoiceTGT.dll`, `SatNavVoiceTGT.ini`, and `SatNavVoiceTGT` subfolder from the live `fh3-mods` folder. Copy the **contents** of `dist/fh3-mods` to the `fh3-mods` next to the `azimuth.exe` you actually launch. Keep `FH3-SatNavVoice.dll` and `FH3-SatNavVoice.ini` at the top level and `VO_SatNav_EN.bank` inside the `FH3-SatNavVoice` subfolder.
3. Launch FH3 with English speech. Check `fh3-mods/platform.log` for `Installed custom English SatNav bank`, then set a waypoint and listen for a turn prompt. The log confirms the override was written, not that the game played it.

In **Home > MODS > Installed mods > FH3-SatNavVoice**, toggle the custom voice or GitHub update checks. Both changes take effect after a restart. The platform checks [releases in this mod's GitHub repository](https://github.com/suderek22/FH3-SatNav-Voice_TGT/releases) and shows newer versions in **MODS > Updates**; it does not auto-install them. To uninstall, close Azimuth and remove the three mod items from its `fh3-mods` folder. The platform cleans up its previously registered file override on next launch.

The generated PCM bank takes about 500 MiB plus a second copy in the game's `mediaoverride` folder. Allow at least 1.5 GiB free when rebuilding and installing. The original bank in `media` is not changed.


## What changed from FH2

FH3 requests `audio/fmodopus/xboxone/VO_SatNav_EN.bank`, not the FH2 `HZ2_DX_SatNav_EN.bank`. The FH3 bank has 4,180 unnamed XMA2 subsounds. The builder matches the FH2 mappings in [tools/mapping.csv](tools/mapping.csv) to the English FH3 `SatNav/` keys in `DialogueScript.xml`, then resolves the case-sensitive FMOD sound-table hashes to subsound indices (Bob Jenkins's public-domain `lookup3` algorithm).
