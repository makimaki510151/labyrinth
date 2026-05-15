#!/usr/bin/env python3
"""Generate maps/N.png using DFS maze (same family as existing levels). Size = 2*N + 7."""
from __future__ import annotations

import random
from collections import deque
from pathlib import Path

from PIL import Image

RGB_WALL = (0, 0, 0)
RGB_PATH = (255, 255, 255)
RGB_START = (0, 0, 255)
RGB_GOAL = (255, 0, 0)


def maze_size_for_level(level: int) -> int:
    return 2 * level + 7


def generate_maze_grid(size: int, rng: random.Random) -> list[list[bool]]:
    """True = wall, False = path. Outer ring stays wall; carve from (1,1).

    Iterative DFS (explicit stack) — large levels exceed Python recursion limit.
    """
    assert size % 2 == 1
    grid = [[True] * size for _ in range(size)]
    stack: list[tuple[int, int]] = [(1, 1)]
    grid[1][1] = False
    dirs_template = [(0, -2), (0, 2), (-2, 0), (2, 0)]

    while stack:
        cx, cy = stack[-1]
        dirs = list(dirs_template)
        rng.shuffle(dirs)
        for dx, dy in dirs:
            nx, ny = cx + dx, cy + dy
            if 0 < nx < size - 1 and 0 < ny < size - 1 and grid[ny][nx]:
                grid[cy + dy // 2][cx + dx // 2] = False
                grid[ny][nx] = False
                stack.append((nx, ny))
                break
        else:
            stack.pop()

    return grid


def bfs_farthest(
    grid: list[list[bool]], sx: int, sy: int
) -> tuple[tuple[int, int], dict[tuple[int, int], int]]:
    size = len(grid)
    dist: dict[tuple[int, int], int] = {(sx, sy): 0}
    q: deque[tuple[int, int]] = deque([(sx, sy)])
    far = (sx, sy)
    while q:
        x, y = q.popleft()
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if (
                0 <= nx < size
                and 0 <= ny < size
                and not grid[ny][nx]
                and (nx, ny) not in dist
            ):
                dist[(nx, ny)] = dist[(x, y)] + 1
                if dist[(nx, ny)] > dist[far]:
                    far = (nx, ny)
                q.append((nx, ny))
    return far, dist


def tree_diameter_endpoints(
    grid: list[list[bool]],
) -> tuple[tuple[int, int], tuple[int, int]]:
    """Two BFS passes on the maze tree — longest approximate path endpoints."""
    a, _ = bfs_farthest(grid, 1, 1)
    b, _ = bfs_farthest(grid, a[0], a[1])
    return a, b


def grid_to_png(grid: list[list[bool]], path: Path, start: tuple[int, int], goal: tuple[int, int]) -> None:
    size = len(grid)
    im = Image.new("RGB", (size, size), RGB_WALL)
    px = im.load()
    for y in range(size):
        for x in range(size):
            if not grid[y][x]:
                px[x, y] = RGB_PATH
    sx, sy = start
    gx, gy = goal
    px[sx, sy] = RGB_START
    px[gx, gy] = RGB_GOAL
    im.save(path, format="PNG")


def main() -> None:
    root = Path(__file__).resolve().parent
    maps_dir = root / "maps"
    for level in (27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50):
        rng = random.Random(0x4CAB + level * 9973)
        size = maze_size_for_level(level)
        grid = generate_maze_grid(size, rng)
        start, goal = tree_diameter_endpoints(grid)
        out = maps_dir / f"{level}.png"
        grid_to_png(grid, out, start, goal)
        walls = sum(grid[y][x] for y in range(size) for x in range(size))
        print(f"wrote {out} ({size}x{size}) start={start} goal={goal} wall%={100*walls/(size*size):.2f}")


if __name__ == "__main__":
    main()
