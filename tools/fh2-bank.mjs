import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const member = 'fh2-mods/SatNav/HZ2_DX_SatNav_EN.bank';

export function readVoicePack(path) {
    let bank;
    if (/\.zip$/i.test(path)) {
        const result = spawnSync('tar', ['-xOf', path, member], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Could not read ${member} from ${path}: ${result.stderr.toString().trim()}`);
        bank = result.stdout;
    } else {
        bank = readFileSync(path);
    }

    const requireFormat = condition => {
        if (!condition) throw new Error('Expected a named, mono 48 kHz PCM16 FH2 English SatNav bank');
    };
    requireFormat(bank.length >= 12 && bank.toString('ascii', 0, 4) === 'RIFF' && bank.toString('ascii', 8, 12) === 'FEV '
        && bank.readUInt32LE(4) + 8 === bank.length);
    let fsb;
    for (let cursor = 12; cursor + 8 <= bank.length;) {
        const size = bank.readUInt32LE(cursor + 4);
        const end = cursor + 8 + size;
        requireFormat(end <= bank.length);
        if (bank.toString('ascii', cursor, cursor + 4) === 'SND ') {
            const chunk = bank.subarray(cursor + 8, end);
            const start = chunk.indexOf('FSB5');
            requireFormat(start >= 0);
            fsb = chunk.subarray(start);
            break;
        }
        cursor = end + size % 2;
    }
    requireFormat(fsb && fsb.length >= 60 && fsb.readUInt32LE(4) === 1 && fsb.readUInt32LE(24) === 2
        && (fsb.readUInt32LE(28) & 1) === 0);
    const count = fsb.readUInt32LE(8);
    const namesStart = 60 + fsb.readUInt32LE(12);
    const dataStart = namesStart + fsb.readUInt32LE(16);
    requireFormat(count === 122 && namesStart === 60 + count * 8 && dataStart >= namesStart + count * 4
        && dataStart + fsb.readUInt32LE(20) === fsb.length);
    const clips = new Map();
    let previousEnd = dataStart;
    for (let index = 0; index < count; index++) {
        const flags = fsb.readBigUInt64LE(60 + index * 8);
        const offset = dataStart + Number((flags >> 7n) & 0x7ffffffn) * 32;
        const end = offset + Number(flags >> 34n) * 2;
        const nameStart = namesStart + fsb.readUInt32LE(namesStart + index * 4);
        const nameEnd = fsb.indexOf(0, nameStart);
        requireFormat((flags & 127n) === 18n && offset >= previousEnd && end > offset && end <= fsb.length
            && nameStart >= namesStart + count * 4 && nameEnd > nameStart && nameEnd < dataStart);
        const name = fsb.toString('utf8', nameStart, nameEnd).toLowerCase();
        requireFormat(!clips.has(name));
        clips.set(name, fsb.subarray(offset, end));
        previousEnd = end;
    }
    return clips;
}
