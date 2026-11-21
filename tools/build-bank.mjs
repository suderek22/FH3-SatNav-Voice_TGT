import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { readVoicePack } from './fh2-bank.mjs';
import { hashKey } from './lookup3.mjs';

const rate = 48000;
const blockSize = 2048;
const fsbHeaderBytes = 60;
const count = 4180;
const pad = size => (32 - size % 32) % 32;

function requireFormat(condition, message) {
    if (!condition) throw new Error(message);
}

function chunks(bank, start, end) {
    const result = new Map();
    for (let cursor = start; cursor < end;) {
        requireFormat(cursor + 8 <= end, 'Truncated FEV chunk header');
        const name = bank.toString('ascii', cursor, cursor + 4);
        const size = bank.readUInt32LE(cursor + 4);
        requireFormat(cursor + 8 + size <= end, `Truncated FEV chunk ${name}`);
        if (name !== 'LIST' || bank.toString('ascii', cursor + 8, cursor + 12) === 'PROJ') {
            requireFormat(!result.has(name), `Unexpected duplicate FEV chunk ${name}`);
            result.set(name, { start: cursor + 8, end: cursor + 8 + size });
        }
        cursor += 8 + size + size % 2;
    }
    return result;
}

function parseBank(bank, expectedMode) {
    requireFormat(bank.toString('ascii', 0, 4) === 'RIFF' && bank.toString('ascii', 8, 12) === 'FEV '
        && bank.readUInt32LE(4) + 8 === bank.length, 'Expected the FH3 English FEV bank');
    const top = chunks(bank, 12, bank.length);
    const project = top.get('LIST');
    const sound = top.get('SND ');
    requireFormat(project && sound && sound.end === bank.length, 'Unsupported FEV container layout');
    const metadata = chunks(bank, project.start + 4, project.end);
    const soundHeader = metadata.get('SNDH');
    const table = metadata.get('STBL');
    requireFormat(soundHeader?.end - soundHeader?.start === 12 && table, 'Missing FEV sound metadata');
    const fsbStart = bank.readUInt32LE(soundHeader.start + 4);
    requireFormat(fsbStart === sound.start + 16 && fsbStart + bank.readUInt32LE(soundHeader.start + 8) === sound.end
        && bank.toString('ascii', fsbStart, fsbStart + 4) === 'FSB5'
        && bank.readUInt32LE(fsbStart + 4) === 1 && bank.readUInt32LE(fsbStart + 8) === count
        && bank.readUInt32LE(fsbStart + 16) === 0 && bank.readUInt32LE(fsbStart + 24) === expectedMode,
        'Unexpected FH3 FSB5 header or codec');
    const keys = table.start + 10;
    const indices = keys + count * 8 + 2;
    requireFormat(bank.readUInt32LE(table.start + 4) === 0 && bank.readUInt16LE(keys - 2) === count
        && bank.readUInt16LE(indices - 2) === count && table.end === indices + count * 3,
        'Unsupported FEV sound-table layout');
    const indexByKey = new Map();
    for (let index = 0; index < count; index++) {
        indexByKey.set(bank.readBigUInt64LE(keys + index * 8), bank.readUIntLE(indices + index * 3, 3));
    }
    requireFormat(indexByKey.size === count && new Set(indexByKey.values()).size === count
        && Math.max(...indexByKey.values()) === count - 1, 'Invalid FEV sound-table sample references');

    const headerEnd = fsbStart + fsbHeaderBytes + bank.readUInt32LE(fsbStart + 12);
    const data = bank.subarray(headerEnd, sound.end);
    requireFormat(data.length === bank.readUInt32LE(fsbStart + 20), 'Invalid FSB5 data size');
    const samples = [];
    let cursor = fsbStart + fsbHeaderBytes;
    for (let index = 0; index < count; index++) {
        const flags = bank.readBigUInt64LE(cursor);
        const sample = { offset: Number((flags >> 7n) & 0x7ffffffn) * 32, frames: Number(flags >> 34n) };
        requireFormat(((flags >> 1n) & 63n) === 9n && sample.frames > 0, `Sample ${index} is not mono 48 kHz`);
        cursor += 8;
        let more = Number(flags & 1n);
        while (more) {
            const extra = bank.readUInt32LE(cursor);
            const type = extra >>> 25;
            const size = (extra >>> 1) & 0xffffff;
            requireFormat(type === 6 || (type === 13 && size === 4), `Unsupported sample metadata ${type}`);
            if (type === 13) sample.peak = bank.subarray(cursor + 4, cursor + 8);
            cursor += 4 + size;
            more = extra & 1;
        }
        samples.push(sample);
    }
    requireFormat(headerEnd - cursor >= 0 && headerEnd - cursor < 32 && samples[0].offset === 0,
        'Invalid FSB5 sample headers');
    for (let index = 0; index < count; index++) {
        const sample = samples[index];
        sample.end = samples[index + 1]?.offset ?? data.length;
        requireFormat(sample.end > sample.offset && sample.end <= data.length, `Invalid data offset for sample ${index}`);
        const length = sample.end - sample.offset;
        requireFormat(expectedMode === 10 ? length % blockSize === 0 : length === sample.frames * 2 + pad(sample.frames * 2),
            `Invalid payload length for sample ${index}`);
    }
    requireFormat(samples.every(sample => sample.peak), 'Missing FSB5 peak metadata');
    return { sound, soundHeader, fsbStart, indexByKey, samples, data };
}

function resolveReplacements(mappingPath, dialoguePath, voicePack, stock) {
    const dialogue = readFileSync(dialoguePath, 'utf8');
    const events = new Map();
    for (const [, key, instruction] of dialogue.matchAll(/<Event\s+name="SatNav\/(HZ3_VO_ANNA_([\w]+)_SatNav)"/g)) {
        events.set(instruction.toLowerCase(), key);
    }
    const mapping = readFileSync(mappingPath, 'utf8').trim().split(/\r?\n/);
    requireFormat(mapping.shift() === 'bank name,source file', 'Expected FH2 bank name,source file mapping');
    const replacements = new Map();
    for (const row of mapping) {
        const match = /^HZ2_VO_ANNA_SatNav_([\w]+),([^,]*)$/.exec(row);
        requireFormat(match, `Invalid mapping row: ${row}`);
        const [, instruction, mappedFile] = match;
        if (!mappedFile) continue;
        const key = events.get(instruction.toLowerCase());
        requireFormat(key, `No FH3 event matches ${instruction}`);
        const index = stock.indexByKey.get(hashKey(key));
        requireFormat(index !== undefined && !replacements.has(index), `Missing or duplicate sample for ${key}`);
        const pcm = voicePack.get(`HZ2_VO_ANNA_SatNav_${instruction}`.toLowerCase());
        requireFormat(pcm, `No PCM recording in the FH2 bank for ${instruction}`);
        replacements.set(index, { key, pcm });
    }
    requireFormat(replacements.size > 0, 'No custom voice clips were mapped');
    return replacements;
}

function xmaWave(data, frames) {
    const header = Buffer.alloc(80);
    header.write('RIFF');
    header.writeUInt32LE(header.length + data.length - 8, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(52, 16);
    header.writeUInt16LE(0x166, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(blockSize, 32);
    header.writeUInt16LE(16, 34);
    header.writeUInt16LE(34, 36);
    header.writeUInt16LE(1, 38);
    header.writeUInt32LE(4, 40);
    header.writeUInt32LE(frames, 44);
    header.writeUInt32LE(blockSize, 48);
    header.writeUInt32LE(frames, 56);
    header[69] = 4;
    header.writeUInt16LE(data.length / blockSize, 70);
    header.write('data', 72);
    header.writeUInt32LE(data.length, 76);
    return Buffer.concat([header, data]);
}

function decode(ffmpeg, input, wav) {
    return new Promise((resolve, reject) => {
        const process = spawn(ffmpeg, ['-v', 'error', '-i', input, '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'],
            { windowsHide: true });
        const output = [];
        const errors = [];
        process.stdout.on('data', bytes => output.push(bytes));
        process.stderr.on('data', bytes => errors.push(bytes));
        process.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
        process.on('error', reject);
        process.on('close', code => code === 0
            ? resolve(Buffer.concat(output))
            : reject(new Error(`FFmpeg failed for ${input}: ${Buffer.concat(errors).toString().trim()}`)));
        process.stdin.end(wav);
    });
}

function pcmPeak(pcm) {
    let peak = 0;
    for (let offset = 0; offset < pcm.length; offset += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
    return peak;
}

async function build(options) {
    const bank = readFileSync(options.bank);
    const stock = parseBank(bank, 10);
    const replacements = resolveReplacements(options.mapping, options.dialogue, readVoicePack(options['source-bank']), stock);
    if (options.inspect) {
        for (const [index, entry] of replacements) console.log(`${index}\t${entry.key}\t${entry.pcm.length / 2} frames`);
        console.log(`${replacements.size} replacements in ${count} samples`);
        return;
    }

    const concurrency = Number(options.jobs);
    requireFormat(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 32, 'Use 1 to 32 jobs');
    const prefix = Buffer.from(bank.subarray(0, stock.fsbStart + fsbHeaderBytes));
    const headers = Buffer.alloc(count * 16);
    const headerSize = headers.length + pad(headers.length);
    const dataStart = prefix.length + headerSize;
    mkdirSync(dirname(options.out), { recursive: true });
    const temporary = `${options.out}.${process.pid}.tmp`;
    const handle = openSync(temporary, 'wx');
    let dataSize = 0;
    try {
        for (let start = 0; start < count; start += concurrency) {
            const batch = await Promise.all(stock.samples.slice(start, start + concurrency).map(async (sample, relative) => {
                const index = start + relative;
                const custom = replacements.get(index);
                if (custom) return custom.pcm;
                const pcm = await decode(options.ffmpeg, 'pipe:0', xmaWave(stock.data.subarray(sample.offset, sample.end), sample.frames));
                requireFormat(pcm.length === sample.frames * 2,
                    `FFmpeg length mismatch for sample ${index}: ${pcm.length / 2} vs ${sample.frames} frames`);
                return pcm;
            }));
            for (const [relative, pcm] of batch.entries()) {
                const index = start + relative;
                const flags = (BigInt(pcm.length / 2) << 34n) | (BigInt(dataSize / 32) << 7n) | 19n;
                headers.writeBigUInt64LE(flags, index * 16);
                headers.writeUInt32LE((13 << 25) | (4 << 1), index * 16 + 8);
                if (replacements.has(index)) headers.writeFloatLE(pcmPeak(pcm) / 32768, index * 16 + 12);
                else stock.samples[index].peak.copy(headers, index * 16 + 12);
                writeSync(handle, pcm, 0, pcm.length, dataStart + dataSize);
                dataSize += pcm.length;
                const padding = pad(dataSize);
                if (padding) writeSync(handle, Buffer.alloc(padding), 0, padding, dataStart + dataSize);
                dataSize += padding;
            }
            if (start % (concurrency * 32) === 0) console.log(`Rebuilt ${start + batch.length}/${count} samples`);
        }
        const fsbSize = fsbHeaderBytes + headerSize + dataSize;
        prefix.writeUInt32LE(dataStart + dataSize - 8, 4);
        prefix.writeUInt32LE(fsbSize + 16, stock.sound.start - 4);
        prefix.writeUInt32LE(fsbSize, stock.soundHeader.start + 8);
        prefix.writeUInt32LE(headerSize, stock.fsbStart + 12);
        prefix.writeUInt32LE(dataSize, stock.fsbStart + 20);
        prefix.writeUInt32LE(2, stock.fsbStart + 24);
        writeSync(handle, prefix, 0, prefix.length, 0);
        writeSync(handle, headers, 0, headers.length, prefix.length);
    } catch (error) {
        closeSync(handle);
        rmSync(temporary);
        throw error;
    }
    closeSync(handle);
    try {
        const rebuilt = parseBank(readFileSync(temporary), 2);
        requireFormat([...stock.indexByKey].every(([key, index]) => rebuilt.indexByKey.get(key) === index),
            'Rebuilt FEV changed the sound table');
        requireFormat(rebuilt.samples.every((sample, index) => {
            const custom = replacements.get(index);
            if (!custom) return sample.frames === stock.samples[index].frames;
            return sample.frames * 2 === custom.pcm.length
                && rebuilt.data.subarray(sample.offset, sample.offset + sample.frames * 2).equals(custom.pcm);
        }), 'Rebuilt FSB changed a custom recording or a stock duration');
        renameSync(temporary, options.out);
    } catch (error) {
        rmSync(temporary);
        throw error;
    }
    console.log(`Replaced ${replacements.size}/${count} samples: ${options.out}`);
}

const { values: options } = parseArgs({ options: {
    bank: { type: 'string' }, dialogue: { type: 'string' }, mapping: { type: 'string' }, 'source-bank': { type: 'string' },
    out: { type: 'string' }, ffmpeg: { type: 'string', default: 'ffmpeg' }, jobs: { type: 'string', default: '8' },
    inspect: { type: 'boolean' },
} });
try {
    requireFormat(options.bank && options.dialogue && options.mapping && options['source-bank'] && (options.inspect || options.out),
        'Use --bank, --dialogue, --mapping, --source-bank, and either --out or --inspect');
    await build(options);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
