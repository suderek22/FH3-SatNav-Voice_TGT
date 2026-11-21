#include "fh3mod.h"

#include <windows.h>

#include <cstddef>
#include <cstring>
#include <filesystem>
#include <string>

extern "C" IMAGE_DOS_HEADER __ImageBase;

namespace {

namespace fs = std::filesystem;
constexpr wchar_t kSection[] = L"FH3-SatNavVoice";
constexpr char kMediaPath[] = "audio/fmodopus/xboxone/VO_SatNav_EN.bank";
constexpr LONGLONG kMaxBankBytes = 640LL * 1024 * 1024;
fs::path settingsPath;

struct Handle {
    HANDLE value;
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};

struct Mapping {
    const void* data;
    ~Mapping() { if (data) UnmapViewOfFile(data); }
};

void saveSetting(void*, const char* key, int value) {
    const wchar_t* entry = std::strcmp(key, "CheckUpdates") == 0 ? L"CheckUpdates" : L"CustomVoice";
    WritePrivateProfileStringW(kSection, entry, value ? L"1" : L"0", settingsPath.c_str());
}

void addToggle(const FH3ModApi* api, FH3Mod* mod, const char* key, const char* label,
               const char* description, bool enabled) {
    FH3Setting setting{};
    setting.size = sizeof setting;
    setting.key = key;
    setting.label = label;
    setting.description = description;
    setting.value = enabled;
    setting.needs_restart = 1;
    setting.on_change = saveSetting;
    if (!api->add_setting(mod, &setting)) api->log(mod, "Could not add a Mods menu toggle.");
}

bool installBank(const FH3ModApi* api, FH3Mod* mod, const fs::path& path) {
    const Handle file{CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                  FILE_ATTRIBUTE_NORMAL, nullptr)};
    if (file.value == INVALID_HANDLE_VALUE) {
        api->log(mod, "Cannot open FH3-SatNavVoice/VO_SatNav_EN.bank; using stock voices.");
        return false;
    }
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file.value, &size) || size.QuadPart < 12 || size.QuadPart > kMaxBankBytes) {
        api->log(mod, "Invalid English voice bank size; using stock voices.");
        return false;
    }
    const Handle mapping{CreateFileMappingW(file.value, nullptr, PAGE_READONLY, 0, 0, nullptr)};
    const Mapping view{mapping.value ? MapViewOfFile(mapping.value, FILE_MAP_READ, 0, 0, 0) : nullptr};
    if (!view.data) {
        api->log(mod, "Could not map the English voice bank; using stock voices.");
        return false;
    }
    const auto* bytes = static_cast<const unsigned char*>(view.data);
    uint32_t riffSize{};
    std::memcpy(&riffSize, bytes + 4, sizeof riffSize);
    if (std::memcmp(bytes, "RIFF", 4) != 0 || std::memcmp(bytes + 8, "FEV ", 4) != 0 ||
        static_cast<LONGLONG>(riffSize) + 8 != size.QuadPart) {
        api->log(mod, "Invalid English voice bank header; using stock voices.");
        return false;
    }
    if (!api->set_file(mod, kMediaPath, view.data, static_cast<size_t>(size.QuadPart))) {
        api->log(mod, "FH3 Mod Platform did not accept the English voice bank override.");
        return false;
    }
    api->log(mod, "Installed custom English SatNav bank.");
    return true;
}

}

FH3MOD_EXPORT int fh3mod_init(const FH3ModApi* api) {
    if (!api || api->api_version < 9 || api->size < offsetof(FH3ModApi, add_setting) + sizeof(api->add_setting) ||
        !api->register_mod || !api->log || !api->set_file || !api->add_setting) return 1;

    std::wstring modulePath(32768, L'\0');
    const DWORD length = GetModuleFileNameW(reinterpret_cast<HMODULE>(&__ImageBase), modulePath.data(),
                                            static_cast<DWORD>(modulePath.size()));
    if (!length || length >= modulePath.size()) return 1;
    modulePath.resize(length);
    const fs::path modDir = fs::path(modulePath).parent_path();
    settingsPath = modDir / L"FH3-SatNavVoice.ini";
    const bool enabled = GetPrivateProfileIntW(kSection, L"CustomVoice", 1, settingsPath.c_str()) != 0;
    const bool updates = GetPrivateProfileIntW(kSection, L"CheckUpdates", 1, settingsPath.c_str()) != 0;

    FH3ModInfo info{};
    info.size = sizeof info;
    info.name = "FH3-SatNavVoice";
    info.version = MOD_VERSION;
    info.github_repo = "suderek22/FH3-SatNav-Voice_TGT";
    info.platform_version = PLATFORM_VERSION;
    info.check_updates = updates;
    info.description = "Replaces English ANNA navigation prompts with the TGT voice pack.";
    FH3Mod* mod = api->register_mod(&info);
    if (!mod) return 1;

    bool installed = false;
    if (enabled) installed = installBank(api, mod, modDir / L"FH3-SatNavVoice" / L"VO_SatNav_EN.bank");
    else api->log(mod, "CustomVoice=0; using stock voices.");
    addToggle(api, mod, "CustomVoice", "Custom English voice",
              installed ? "English bank installed. Restart the game to apply changes."
                        : "English bank not installed this session. Restart the game to apply changes.", enabled);
    addToggle(api, mod, "CheckUpdates", "Check for updates",
              "Check GitHub for new mod releases. Restart the game to apply changes.", updates);
    return 0;
}
