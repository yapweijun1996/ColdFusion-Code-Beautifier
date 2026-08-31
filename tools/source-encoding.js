'use strict';

/* Decode/encode source files without changing their original BOM/UTF width.
 * The CLI must handle legacy UTF-16BE CFML exports as well as normal UTF-8;
 * reading those bytes as UTF-8 produces NULs and replacement characters. */

function swapUtf16Bytes(buffer, start) {
	var length = buffer.length - start;
	var evenLength = length - (length % 2);
	var out = Buffer.alloc(evenLength);
	for (var i = 0; i < evenLength; i += 2) {
		out[i] = buffer[start + i + 1];
		out[i + 1] = buffer[start + i];
	}
	return out;
}

function decodeSource(buffer) {
	if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
	if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
		return {
			text: swapUtf16Bytes(buffer, 2).toString('utf16le'),
			encoding: 'utf16be',
			bom: true
		};
	}
	if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
		return {
			text: buffer.slice(2).toString('utf16le'),
			encoding: 'utf16le',
			bom: true
		};
	}
	if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
		return {
			text: buffer.slice(3).toString('utf8'),
			encoding: 'utf8',
			bom: true
		};
	}
	return { text: buffer.toString('utf8'), encoding: 'utf8', bom: false };
}

function encodeSource(text, format) {
	var meta = format || { encoding: 'utf8', bom: false };
	var value = String(text == null ? '' : text);
	var body;
	if (meta.encoding === 'utf16be' || meta.encoding === 'utf16le') {
		body = Buffer.from(value, 'utf16le');
		if (meta.encoding === 'utf16be') body = swapUtf16Bytes(body, 0);
		if (!meta.bom) return body;
		var utf16Bom = meta.encoding === 'utf16be'
			? Buffer.from([0xFE, 0xFF])
			: Buffer.from([0xFF, 0xFE]);
		return Buffer.concat([utf16Bom, body]);
	}
	body = Buffer.from(value, 'utf8');
	return meta.bom
		? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body])
		: body;
}

module.exports = {
	decodeSource: decodeSource,
	encodeSource: encodeSource
};
