#!/usr/bin/env python3
"""Paints the Crystal dark backdrop: a layered nebula with a light source, light rays, stars with
glow and three depth layers of crimson crystal shards (far and hazy, middle and sharp, near and out of
focus). Everything is generated here; no outside image is used.

  paint.py <out file> [width height] [--exposure 1.0]
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, map_coordinates

out = sys.argv[1]
W, H = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 and not sys.argv[2].startswith("--") else (1920, 1200)
exposure = float(sys.argv[sys.argv.index("--exposure") + 1]) if "--exposure" in sys.argv else 1.0
S = W / 1920  # every pixel size below is given for a 1920 wide image

v, u = np.mgrid[0:H, 0:W].astype(np.float32)
u /= W
v /= H
aspect = W / H


def fbm(seed: int, base: int = 3, octaves: int = 7, gain: float = 0.55) -> np.ndarray:
    r = np.random.default_rng(seed)
    acc = np.zeros((H, W), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = base * 2 ** o
        grid = (r.random((max(2, int(n / aspect) + 2), n + 2)) * 255).astype(np.uint8)
        acc += amp * np.asarray(Image.fromarray(grid).resize((W, H), Image.BICUBIC), np.float32) / 255
        total += amp
        amp *= gain
    acc /= total
    lo, hi = np.percentile(acc, 1), np.percentile(acc, 99)
    return np.clip((acc - lo) / (hi - lo), 0, 1)


def warp(field: np.ndarray, seed: int, strength: float) -> np.ndarray:
    dx, dy = fbm(seed, 2, 5) - 0.5, fbm(seed + 1, 2, 5) - 0.5
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    return map_coordinates(field, [yy + dy * strength * H, xx + dx * strength * W], order=1, mode="reflect")


def glow(cx: float, cy: float, sx: float, sy: float) -> np.ndarray:
    return np.exp(-(((u - cx) / sx) ** 2 + ((v - cy) / sy) ** 2) / 2)


def rgb(*c: float) -> np.ndarray:
    return np.array(c, np.float32)[None, None, :]


clouds = warp(fbm(11), 21, 0.22)
wisps = warp(fbm(31, 5, 7, 0.6), 41, 0.3)
dark = warp(fbm(51, 2, 6), 61, 0.25)

# Base sky: violet in the lower left, deep blue through the middle, teal toward the upper right.
t = np.clip(0.62 * u + 0.38 * (1 - v), 0, 1)[..., None]
violet, blue, teal = rgb(0.13, 0.04, 0.34), rgb(0.04, 0.10, 0.44), rgb(0.02, 0.34, 0.50)
img = np.where(t < 0.5, violet + (blue - violet) * (t / 0.5), blue + (teal - blue) * ((t - 0.5) / 0.5))

# The light source and the clouds it lights.
LX, LY = 0.76, 0.72
core = glow(LX, LY, 0.19, 0.21)
halo = glow(LX, LY, 0.42, 0.50)
img += (core * (0.15 + 1.35 * clouds ** 1.4))[..., None] * rgb(0.10, 0.78, 0.82) * 0.95
img += (halo * (0.25 + 0.9 * wisps ** 1.5))[..., None] * rgb(0.05, 0.42, 0.62) * 0.55
img += (glow(LX + 0.03, LY - 0.02, 0.07, 0.085) * (0.5 + 0.7 * clouds))[..., None] * rgb(0.75, 1.0, 0.98) * 0.55
# Coloured gas: magenta low on the left, violet high on the left, a warm crimson breath at the lower right.
img += (glow(0.10, 0.86, 0.26, 0.30) * (0.2 + wisps))[..., None] * rgb(0.62, 0.10, 0.52) * 0.55
img += (glow(0.20, 0.16, 0.24, 0.26) * (0.2 + clouds))[..., None] * rgb(0.30, 0.12, 0.70) * 0.45
img += (glow(0.90, 0.95, 0.22, 0.22) * (0.2 + wisps))[..., None] * rgb(0.70, 0.08, 0.26) * 0.40

# Dust lanes in front of the light give the sky its depth.
img *= (0.30 + 1.05 * dark ** 1.5)[..., None]

# Light rays fanning out of the source.
ang = np.arctan2((v - LY) / aspect, u - LX)
dist = np.hypot((u - LX), (v - LY) / aspect)
r = np.random.default_rng(71)
strip = gaussian_filter(r.random(2048).astype(np.float32), 5, mode="wrap")
strip = np.clip((strip - strip.mean()) / (strip.std() * 2.2), 0, 1) ** 2
rays = strip[((ang + math.pi) / (2 * math.pi) * 2047).astype(np.int32)]
rays = gaussian_filter(rays, 2 * S) * np.exp(-dist / 0.55) * np.clip(dist / 0.05, 0, 1)
img += rays[..., None] * rgb(0.55, 0.95, 1.0) * 0.30

# Two long diagonal streaks, as if a shard caught the light.
for offset, width, tint, strength in ((0.47, 0.012, rgb(0.6, 1.0, 1.0), 0.16), (0.60, 0.007, rgb(1.0, 0.6, 0.8), 0.11)):
    line = np.exp(-(((u * 0.80 + v * 0.60 / aspect * 1.6) / 1.4 - offset) / width) ** 2)
    img += (line * (0.4 + 0.6 * wisps))[..., None] * tint * strength

# Vignette.
img *= np.clip(1.08 - 0.75 * ((u - 0.56) ** 2 * 1.5 + (v - 0.46) ** 2 * 1.7), 0.25, 1.1)[..., None]

# Stars: dust, small glowing stars, a few flares.
stars = np.zeros((H, W), np.float32)
n = int(5200 * S * S)
sx, sy = r.integers(0, W, n), r.integers(0, H, n)
np.maximum.at(stars, (sy, sx), r.random(n).astype(np.float32) ** 4)
stars = np.maximum(stars, gaussian_filter(stars, 0.7 * S) * 2.4)
medium = np.zeros((H, W), np.float32)
n = int(70 * S)
np.maximum.at(medium, (r.integers(0, H, n), r.integers(0, W, n)), 0.15 + 0.85 * r.random(n).astype(np.float32) ** 2)
medium = gaussian_filter(medium, 1.4 * S) * 14 + gaussian_filter(medium, 5 * S) * 50
star_tint = 0.7 + 0.3 * np.stack([wisps, clouds, np.ones_like(clouds)], -1)
img += (stars * 0.9 + np.clip(medium, 0, 1.2))[..., None] * star_tint


def flare(cx: float, cy: float, size: float, tint: np.ndarray, turn: float = 0.35) -> None:
    px, py = (u - cx) * W, (v - cy) * H
    a, b = px * math.cos(turn) + py * math.sin(turn), -px * math.sin(turn) + py * math.cos(turn)
    size *= S
    spike = np.exp(-np.abs(a) / (size * 0.42)) * np.exp(-(b / (1.4 * S)) ** 2) + np.exp(-np.abs(b) / (size * 0.42)) * np.exp(-(a / (1.4 * S)) ** 2)
    body = np.exp(-(a * a + b * b) / (2 * (size * 0.07) ** 2)) * 1.4 + np.exp(-(a * a + b * b) / (2 * (size * 0.30) ** 2)) * 0.28
    global img
    img += (spike * 0.9 + body)[..., None] * tint


# Crystal shards, drawn at twice the size and scaled down for clean edges.
Q = 2
LIGHT, MID, DARK, EDGE = (255, 66, 100), (190, 20, 58), (70, 5, 26), (255, 214, 222)


def shard(draw: ImageDraw.ImageDraw, x: float, y: float, angle: float, length: float, width: float, fade: float = 1.0) -> tuple[float, float]:
    a = math.radians(angle)
    dx, dy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    p = lambda along, across: ((x + along * length * dx + across * width * nx) * Q * S, (y + along * length * dy + across * width * ny) * Q * S)
    tail, tip, left, right, ridge = p(-0.12, 0), p(1, 0), p(0.24, 1), p(0.30, -1), p(0.33, 0.18)
    shade = lambda c, a=255: tuple(int(k * fade) for k in c) + (a,)
    draw.polygon([tail, right, tip, ridge], fill=shade(DARK))
    draw.polygon([right, tip, p(0.42, -0.42)], fill=shade((112, 9, 38)))
    draw.polygon([tail, left, ridge], fill=shade((128, 11, 42)))
    draw.polygon([left, tip, ridge], fill=shade(MID))
    draw.polygon([left, p(0.62, 0.50), p(0.40, 0.42)], fill=shade(LIGHT))
    draw.polygon([p(0.40, 0.42), p(0.62, 0.50), tip, p(0.52, 0.24)], fill=shade((232, 40, 82)))
    draw.polygon([p(0.28, 0.80), p(0.46, 0.66), p(0.33, 0.52)], fill=shade((255, 176, 192)))
    draw.line([left, tip], fill=shade(EDGE), width=max(1, int(1.8 * Q * S)))
    draw.line([tail, ridge, tip], fill=shade((255, 104, 134)), width=max(1, int(0.9 * Q * S)))
    draw.line([right, tip], fill=shade((150, 16, 50)), width=max(1, int(0.9 * Q * S)))
    return (x + length * dx) / 1920, (y + length * dy) / (1920 / aspect)


def layer(shards: list[tuple[float, float, float, float, float]], blur: float, opacity: float, fade: float = 1.0) -> tuple[np.ndarray, np.ndarray, list[tuple[float, float]]]:
    canvas = Image.new("RGBA", (W * Q, H * Q), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    tips = [shard(d, *s, fade=fade) for s in shards]
    canvas = canvas.resize((W, H), Image.LANCZOS)
    if blur:
        # Blur with premultiplied alpha so soft edges do not darken.
        arr = np.asarray(canvas, np.float32) / 255
        pre = arr[..., :3] * arr[..., 3:]
        pre = np.stack([gaussian_filter(pre[..., k], blur * S) for k in range(3)], -1)
        alpha = gaussian_filter(arr[..., 3], blur * S)
        return pre, alpha * opacity, tips
    arr = np.asarray(canvas, np.float32) / 255
    return arr[..., :3] * arr[..., 3:], arr[..., 3] * opacity, tips


HH = 1920 / aspect
far = []
fr = np.random.default_rng(5)
for _ in range(16):
    fx, fy = fr.random() * 1920, (0.34 + 0.66 * fr.random()) * HH
    away = math.degrees(math.atan2(fy - LY * HH, fx - LX * 1920)) + fr.normal(0, 22)
    far.append((fx, fy, away, 46 + fr.random() * 110, 6 + fr.random() * 10))
pre, alpha, _ = layer(far, 2.2, 0.55, fade=0.8)
img = img * (1 - alpha[..., None]) + pre * 0.55
img += (gaussian_filter(alpha, 14 * S) * 0.10)[..., None] * rgb(1.0, 0.25, 0.4)

mid = [
    (1990, HH + 70, 196, 520, 46), (1990, HH + 70, 213, 820, 78), (1990, HH + 70, 229, 640, 58), (1990, HH + 70, 246, 880, 84), (1990, HH + 70, 263, 480, 40),
    (-70, HH + 70, -12, 430, 38), (-70, HH + 70, -30, 640, 62), (-70, HH + 70, -50, 500, 46), (-70, HH + 70, -70, 560, 52),
    (1990, -70, 112, 300, 30), (1990, -70, 133, 430, 44), (1990, -70, 156, 340, 32),
    (1500, HH * 0.52, -52, 170, 24), (1530, HH * 0.52 + 40, -18, 120, 17), (1470, HH * 0.52 + 55, -96, 105, 15),
    (420, HH * 0.70, 205, 150, 21), (450, HH * 0.70 + 30, 250, 120, 17),
]
pre, alpha, tips = layer(mid, 0.5, 1.0)
halo_red = np.stack([gaussian_filter(pre[..., k], 26 * S) for k in range(3)], -1)
img += halo_red * 0.42
lit = (0.50 + 0.75 * halo + 0.25 * clouds)[..., None] * (1 + 0.5 * core[..., None] * rgb(0.2, 0.9, 1.0))
img = img * (1 - alpha[..., None]) + np.clip(pre * lit, 0, 1.3)

near = [(-190, HH * 0.86, -14, 900, 150), (760, HH + 240, -74, 600, 110), (2100, HH * 0.30, 196, 520, 120)]
pre, alpha, _ = layer(near, 13, 1.0, fade=0.62)
img = img * (1 - (alpha * 0.92)[..., None]) + pre * 0.92 * (0.75 + 0.5 * dark)[..., None]
img += np.stack([gaussian_filter(pre[..., k], 70 * S) for k in range(3)], -1) * 0.28

flare(tips[1][0], tips[1][1], 250, rgb(1.0, 0.86, 0.90) * 0.95)
flare(tips[6][0], tips[6][1], 170, rgb(1.0, 0.86, 0.90) * 0.8, 0.2)
flare(tips[12][0], tips[12][1], 120, rgb(1.0, 0.9, 0.93) * 0.8, 0.5)
flare(0.93, 0.34, 80, rgb(0.8, 1.0, 1.0) * 0.7)
flare(0.50, 0.86, 70, rgb(0.8, 1.0, 1.0) * 0.7, 0.1)
flare(0.30, 0.52, 56, rgb(1.0, 0.85, 0.95) * 0.55, 0.6)

# Bloom, exposure, a soft filmic shoulder and a little grain against banding.
bright = np.clip(img - 0.55, 0, None)
img += np.stack([gaussian_filter(bright[..., k], 22 * S) for k in range(3)], -1) * 0.7
img *= exposure
img = 1 - np.exp(-img * 1.25)
img += (np.random.default_rng(99).random((H, W, 1)).astype(np.float32) - 0.5) * 0.012
Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out, quality=84, method=6)
print(out, W, H)
