#!/usr/bin/env python3
"""从 Windows Explorer 的 .ico 导出 macOS Finder 菜单用 PNG（无第三方依赖）。"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path


def parse_ico_entries(data: bytes) -> list[tuple[int, int, int, int, int]]:
    if data[:4] != b"\x00\x00\x01\x00":
        raise ValueError("不是有效的 ICO 文件")
    count = struct.unpack_from("<H", data, 4)[0]
    entries: list[tuple[int, int, int, int, int]] = []
    offset = 6
    for _ in range(count):
        width, height, _colors, _reserved, _planes, bpp, size, data_offset = struct.unpack_from(
            "<BBBBHHII", data, offset
        )
        entries.append((width or 256, height or 256, bpp, size, data_offset))
        offset += 16
    return entries


def ico_entry_to_rgba(data: bytes, prefer: int) -> tuple[int, int, bytes]:
    entries = parse_ico_entries(data)
    width, height, _bpp, size, data_offset = sorted(
        entries, key=lambda item: (abs(item[0] - prefer), -item[0])
    )[0]
    blob = data[data_offset : data_offset + size]
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        # 直接返回 PNG 原始字节时由调用方处理；这里统一转 RGBA
        raise ValueError("暂不解析 ICO 内嵌 PNG，请使用 BMP 位图 ICO")

    header_size = struct.unpack_from("<I", blob, 0)[0]
    bi_width = struct.unpack_from("<i", blob, 4)[0]
    bi_height = struct.unpack_from("<i", blob, 8)[0]
    bi_bit_count = struct.unpack_from("<H", blob, 14)[0]
    bi_compression = struct.unpack_from("<I", blob, 16)[0]
    if bi_bit_count != 32 or bi_compression != 0:
        raise ValueError(f"不支持的位图格式：bpp={bi_bit_count} compression={bi_compression}")

    pixel_height = abs(bi_height)
    # ICO 中高度常为 XOR+AND 两倍
    if pixel_height == height * 2:
        pixel_height = height
    pixel_width = abs(bi_width)
    row = pixel_width * 4
    xor = bytearray(blob[header_size : header_size + row * pixel_height])
    rgba = bytearray(row * pixel_height)
    for y in range(pixel_height):
        src = (pixel_height - 1 - y) * row
        dst = y * row
        for x in range(pixel_width):
            blue, green, red, alpha = xor[src + x * 4 : src + x * 4 + 4]
            rgba[dst + x * 4 : dst + x * 4 + 4] = bytes((red, green, blue, alpha))
    return pixel_width, pixel_height, bytes(rgba)


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def export_icons(source_dir: Path, dest_dir: Path, size: int, actions: list[str]) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    missing: list[str] = []
    for action in actions:
        ico_path = source_dir / f"{action}.ico"
        if not ico_path.is_file():
            missing.append(action)
            continue
        width, height, rgba = ico_entry_to_rgba(ico_path.read_bytes(), prefer=size)
        # 1x / 2x：Finder 菜单约 16pt，导出 16 与 32
        write_png(dest_dir / f"{action}.png", width, height, rgba)
        if size != 16:
            # 额外导出 16px 作为 @1x 后备
            w16, h16, rgba16 = ico_entry_to_rgba(ico_path.read_bytes(), prefer=16)
            write_png(dest_dir / f"{action}@1x.png", w16, h16, rgba16)
            write_png(dest_dir / f"{action}@2x.png", width, height, rgba)
    if missing:
        raise SystemExit(f"缺少菜单图标：{', '.join(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="导出 macOS Finder 菜单 PNG 图标")
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("src-tauri/icons/explorer"),
        help="含 action.ico 的目录",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        required=True,
        help="输出 PNG 目录（通常为 appex Contents/Resources）",
    )
    parser.add_argument("--size", type=int, default=32, help="优先导出尺寸（默认 32）")
    parser.add_argument(
        "--actions",
        nargs="*",
        default=[
            "open",
            "info",
            "diff",
            "blame",
            "revert",
            "delete",
            "ignore",
            "cleanup",
            "branch-workspace",
            "browse",
            "update",
            "commit",
            "log",
            "checkout",
        ],
    )
    args = parser.parse_args()
    export_icons(args.source, args.dest, args.size, args.actions)
    print(f"已导出 {len(args.actions)} 个菜单图标到 {args.dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
