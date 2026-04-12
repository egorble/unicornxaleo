/**
 * Deterministic pixel avatar generator
 * Generates unique 8x8 symmetrical pixel art from wallet address
 */

// Color palettes - picked by first byte of address
const PALETTES = [
    ['#F97316', '#A855F7', '#C084FC'],  // Purple/Aleo
    ['#6C5CE7', '#A29BFE', '#DFE6E9'],  // Purple
    ['#00B894', '#55EFC4', '#81ECEC'],  // Green
    ['#E17055', '#FAB1A0', '#FFEAA7'],  // Coral
    ['#0984E3', '#74B9FF', '#DFE6E9'],  // Blue
    ['#E84393', '#FD79A8', '#FDCB6E'],  // Pink
    ['#00CEC9', '#81ECEC', '#DFE6E9'],  // Teal
    ['#FDCB6E', '#FFEAA7', '#FAB1A0'],  // Gold
    ['#636E72', '#B2BEC3', '#DFE6E9'],  // Gray
    ['#D63031', '#FF7675', '#FFEAA7'],  // Red
    ['#6C5CE7', '#FD79A8', '#FDCB6E'],  // Purple-Pink
    ['#00B894', '#0984E3', '#DFE6E9'],  // Green-Blue
];

/**
 * Parse hex address into numeric bytes
 */
function addressToBytes(address: string): number[] {
    const hex = address.replace('0x', '').toLowerCase();
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes;
}

/**
 * Generate a deterministic pixel avatar as a data URL
 * @param address - Wallet address (0x...)
 * @param size - Output image size in pixels (default 128)
 * @returns data URL string (png)
 */
export function generatePixelAvatar(address: string, size: number = 128): string {
    if (!address || address.length < 10) {
        return generateFallbackAvatar(size);
    }

    const bytes = addressToBytes(address);
    const paletteIndex = bytes[0] % PALETTES.length;
    const palette = PALETTES[paletteIndex];

    // 8x8 grid, but only 4 columns are unique (mirrored for symmetry)
    const gridSize = 8;
    const halfGrid = 4;
    const pixelSize = size / gridSize;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Background - dark or light based on byte
    const bgDark = bytes[1] % 2 === 0;
    ctx.fillStyle = bgDark ? '#1A1A1A' : '#F0F0F0';
    ctx.fillRect(0, 0, size, size);

    // Generate pixels - use bytes 2-19 to determine pixel states
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < halfGrid; x++) {
            const byteIndex = (y * halfGrid + x) % bytes.length;
            const byteVal = bytes[byteIndex >= 2 ? byteIndex : byteIndex + 2];

            // Determine if pixel is filled (roughly 60% chance)
            const isFilled = byteVal > 90;

            if (isFilled) {
                // Pick color from palette
                const colorIndex = byteVal % palette.length;
                ctx.fillStyle = palette[colorIndex];

                // Left side
                ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);

                // Mirrored right side
                const mirrorX = (gridSize - 1 - x) * pixelSize;
                ctx.fillRect(mirrorX, y * pixelSize, pixelSize, pixelSize);
            }
        }
    }

    return canvas.toDataURL('image/png');
}

/**
 * Fallback avatar when no address is available
 */
function generateFallbackAvatar(size: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#F97316';
    const pixelSize = size / 8;
    // Simple "?" pattern
    const pattern = [
        [2, 1], [3, 1], [4, 1], [5, 1],
        [5, 2], [4, 3], [3, 3],
        [3, 5],
    ];
    pattern.forEach(([x, y]) => {
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
    });

    return canvas.toDataURL('image/png');
}
