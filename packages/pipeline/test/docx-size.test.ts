import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { checkDocxSize, UnreadableFile } from "../src/kern/text.ts";

/** A minimal ZIP archive (deflated parts), as a Word file is one. `lie` writes a false unpacked size. */
function zip(parts: { name: string; data: Buffer }[], lie?: number, count = parts.length): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of parts) {
    const packed = deflateRawSync(f.data);
    const name = Buffer.from(f.name);
    const size = lie ?? f.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, packed);
    central.push(ch, name);
    offset += lh.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

describe("Word files: size ceiling before unpacking", () => {
  it("lets a normal file through", () => {
    expect(() => checkDocxSize(zip([{ name: "word/document.xml", data: Buffer.from("<w:t>Hallo</w:t>".repeat(1000)) }]))).not.toThrow();
  });

  it("refuses a file that unpacks beyond the ceiling", () => {
    const bomb = zip([{ name: "word/document.xml", data: Buffer.alloc(3 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(10_000);
    expect(() => checkDocxSize(bomb, 1024 * 1024)).toThrow(UnreadableFile);
  });

  it("is not fooled by a false declared size", () => {
    const bomb = zip([{ name: "word/document.xml", data: Buffer.alloc(3 * 1024 * 1024) }], 100);
    expect(() => checkDocxSize(bomb, 1024 * 1024)).toThrow(/größer als 1 MB/);
  });

  it("adds up the parts", () => {
    const parts = Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.xml`, data: Buffer.alloc(400 * 1024) }));
    expect(() => checkDocxSize(zip(parts), 1024 * 1024)).toThrow(UnreadableFile);
  });

  it("walks every entry, whatever count the archive declares", () => {
    const parts = [
      { name: "word/styles.xml", data: Buffer.from("<w:styles/>") },
      { name: "word/document.xml", data: Buffer.alloc(3 * 1024 * 1024) },
    ];
    expect(() => checkDocxSize(zip(parts, undefined, 1), 1024 * 1024)).toThrow(UnreadableFile);
  });

  it("refuses data in front of the archive", () => {
    const z = zip([{ name: "word/document.xml", data: Buffer.from("<w:t>Hallo</w:t>") }]);
    expect(() => checkDocxSize(new Uint8Array(Buffer.concat([Buffer.from("XXXX"), Buffer.from(z)])))).toThrow(/beschädigt/);
  });

  it("does not unpack pictures, which the text never needs", () => {
    const parts = [
      { name: "word/document.xml", data: Buffer.from("<w:t>Hallo</w:t>") },
      { name: "word/media/image1.png", data: Buffer.alloc(3 * 1024 * 1024) },
    ];
    expect(() => checkDocxSize(zip(parts), 1024 * 1024)).not.toThrow();
  });

  it("calls a non-archive damaged", () => {
    expect(() => checkDocxSize(new TextEncoder().encode("kein Archiv, nur Text ".repeat(10)))).toThrow(/beschädigt/);
  });
});
