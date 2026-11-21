const rotate = (value, bits) => (value << bits) | (value >>> (32 - bits));
const mix = (left, right, bits) => (left - right) ^ rotate(right, bits);
const finish = (left, right, bits) => ((left ^ right) - rotate(right, bits)) | 0;

export function hashKey(key) {
    const input = Buffer.from(key);
    let first = (0xdeadbeef + input.length) | 0;
    let second = first;
    let third = first;
    let offset = 0;
    for (; input.length - offset > 12; offset += 12) {
        first = (first + input.readInt32LE(offset)) | 0;
        second = (second + input.readInt32LE(offset + 4)) | 0;
        third = (third + input.readInt32LE(offset + 8)) | 0;
        for (const [left, middle, right] of [[4, 6, 8], [16, 19, 4]]) {
            first = mix(first, third, left); third = (third + second) | 0;
            second = mix(second, first, middle); first = (first + third) | 0;
            third = mix(third, second, right); second = (second + first) | 0;
        }
    }
    if (offset < input.length) {
        const tail = Buffer.alloc(12);
        input.copy(tail, 0, offset);
        first = (first + tail.readInt32LE(0)) | 0;
        second = (second + tail.readInt32LE(4)) | 0;
        third = (third + tail.readInt32LE(8)) | 0;
        third = finish(third, second, 14);
        first = finish(first, third, 11);
        second = finish(second, first, 25);
        third = finish(third, second, 16);
        first = finish(first, third, 4);
        second = finish(second, first, 14);
        third = finish(third, second, 24);
    }
    return (BigInt(second >>> 0) << 32n) | BigInt(third >>> 0);
}
