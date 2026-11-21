# FH3-SatNavVoice

Ports the English TGT navigation voice pack v1.0.1 from FH2 to Forza Horizon 3 on **Azimuth**, using [FH3 Mod Platform v1.4.2](https://github.com/Levilente/FH3_ModPlatform/releases/tag/v1.4.2). Targets the Xbox One build with executable timestamp `0x5B16ECCA` and English speech. Not for the native Windows Store edition.

## Install

1. Install FH3 Mod Platform alongside `azimuth.exe` if it is not already installed. This mod does not bundle or replace the platform.
2. With Azimuth closed, remove any old `SatNavVoiceTGT.dll`, `SatNavVoiceTGT.ini`, and `SatNavVoiceTGT` subfolder from the live `fh3-mods` folder. Copy the **contents** of `dist/fh3-mods` to the `fh3-mods` next to the `azimuth.exe` you actually launch. Keep `FH3-SatNavVoice.dll` and `FH3-SatNavVoice.ini` at the top level and `VO_SatNav_EN.bank` inside the `FH3-SatNavVoice` subfolder.
3. Launch FH3 with English speech. Check `fh3-mods/platform.log` for `Installed custom English SatNav bank`, then set a waypoint and listen for a turn prompt. The log confirms the override was written, not that the game played it.

In **Home > MODS > Installed mods > FH3-SatNavVoice**, toggle the custom voice or GitHub update checks. Both changes take effect after a restart. The platform checks [releases in this mod's GitHub repository](https://github.com/suderek22/FH3-SatNav-Voice_TGT/releases) and shows newer versions in **MODS > Updates**; it does not auto-install them. To uninstall, close Azimuth and remove the three mod items from its `fh3-mods` folder. The platform cleans up its previously registered file override on next launch.

The generated PCM bank takes about 500 MiB plus a second copy in the game's `mediaoverride` folder. Allow at least 1.5 GiB free when rebuilding and installing. The original bank in `media` is not changed.

## Build

Install Node.js 20+, FFmpeg with XMA2 decoding, CMake, and Visual Studio C++ x64 Build Tools with the Windows SDK. Reading the voice pack ZIP requires Windows `tar.exe`; an extracted `.bank` works too. The SDK header in `sdk/` is pinned to the official `v1.4.2` tag; its MIT license is in [sdk/LICENSE](sdk/LICENSE).

```powershell
.\build.ps1 -SourceBank "$HOME\Downloads\SatNavVoice_EN_TGT_v1.0.1.zip" -FfmpegPath 'X:\path\to\ffmpeg.exe'
```

`-GameMount` defaults to this workspace's FH3 `Mount` directory. `-SourceBank` defaults to the ZIP above; the builder uses only its bank, never its FH2 DLL or INI. `-FfmpegPath` may be omitted if FFmpeg is on `PATH`. `-SkipBank` rebuilds only the DLL and stages the INI. Adjust `-Jobs` if needed. Never commit or redistribute the generated bank: it contains stock FH3 audio.

## What changed from FH2

FH3 requests `audio/fmodopus/xboxone/VO_SatNav_EN.bank`, not the FH2 `HZ2_DX_SatNav_EN.bank`. The FH3 bank has 4,180 unnamed XMA2 subsounds. The builder matches the FH2 mappings in [tools/mapping.csv](tools/mapping.csv) to the English FH3 `SatNav/` keys in `DialogueScript.xml`, then resolves the case-sensitive FMOD sound-table hashes to subsound indices (Bob Jenkins's public-domain `lookup3` algorithm). All 113 populated mappings have FH3 counterparts. The two FH3-only turn-off prompts, destination-set lines not covered by the source pack, and all other bank entries retain stock audio.

The builder copies all 113 custom PCM recordings byte-for-byte from the FH2 v1.0.1 bank. It decodes the remaining FH3 samples to mono 48 kHz PCM16 and preserves the sound-table mapping, bank identity, subsound order, and stock durations for unchanged lines. The DLL uses the official `fh3mod_init` and `set_file` API; it does not patch the executable or hook FMOD. It does not replace other languages or unrelated ANNA dialogue.
