import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const icons = path.join(root, "public/icons");
const spheres = path.join(root, "public/spheres");

describe("application icon inventory", () => {
  it("contains exactly the canonical normal and development assets", () => {
    expect(readdirSync(icons).sort()).toEqual(["app-dev.ico", "app-dev.png", "app.ico", "app.png"]);
    for (const obsolete of ["public/PalSpheres", "public/icon.png", "public/icon.ico", "src/app/favicon.ico", "public/file.svg", "public/globe.svg", "public/next.svg", "public/vercel.svg", "public/window.svg"]) {
      expect(existsSync(path.join(root, obsolete)), obsolete).toBe(false);
    }
  });

  it("contains the complete sphere theme inventory", () => {
    expect(readdirSync(spheres).sort()).toEqual([
      "psm-sphere-blank.svg",
      "psm-spheres-ancient.png",
      "psm-spheres-blank.png",
      "psm-spheres-exotic.png",
      "psm-spheres-giga.png",
      "psm-spheres-hyper.png",
      "psm-spheres-legendary.png",
      "psm-spheres-mega.png",
      "psm-spheres-pal.png",
      "psm-spheres-sol.png",
      "psm-spheres-ultimate.png",
      "psm-spheres-ultra.png",
    ]);
    for (const fileName of readdirSync(spheres).filter((fileName) => fileName.endsWith(".png"))) {
      const bytes = readFileSync(path.join(spheres, fileName));
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], fileName).toEqual([512, 512]);
    }
  });

  it.each(["app.png", "app-dev.png"])("ships %s as a 512 px PNG", (fileName) => {
    const bytes = readFileSync(path.join(icons, fileName));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([512, 512]);
  });

  it.each(["app.ico", "app-dev.ico"])("ships %s with tray-sized variants", (fileName) => {
    const bytes = readFileSync(path.join(icons, fileName));
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    const count = bytes.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => {
      const width = bytes[6 + index * 16]!; return width === 0 ? 256 : width;
    });
    expect(sizes).toEqual(expect.arrayContaining([16, 24, 32, 48, 64, 128, 256]));
  });
});
