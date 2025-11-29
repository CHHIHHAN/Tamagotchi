export async function createPixelArt(imageSource, size = 16, paletteSize = 16) {
    const image = await loadImage(imageSource);
    const scale = Math.min(size / image.width, size / image.height);
    const scaledWidth = Math.max(1, Math.round(image.width * scale));
    const scaledHeight = Math.max(1, Math.round(image.height * scale));

    const scaledCanvas = document.createElement("canvas");
    scaledCanvas.width = scaledWidth;
    scaledCanvas.height = scaledHeight;
    const scaledCtx = scaledCanvas.getContext("2d");
    scaledCtx.imageSmoothingEnabled = false;
    scaledCtx.drawImage(image, 0, 0, scaledWidth, scaledHeight);

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = size;
    finalCanvas.height = size;
    const finalCtx = finalCanvas.getContext("2d");
    finalCtx.imageSmoothingEnabled = false;
    finalCtx.clearRect(0, 0, size, size);

    const offsetX = Math.floor((size - scaledWidth) / 2);
    const offsetY = Math.floor((size - scaledHeight) / 2);
    finalCtx.drawImage(scaledCanvas, offsetX, offsetY);

    let imageData = finalCtx.getImageData(0, 0, size, size);
    imageData = applyMedianFilter(imageData);
    const eyes = addEyesToPixelArt(imageData.data, size, size);

    const quantized = applyPaletteQuantization(imageData, paletteSize);
    finalCtx.putImageData(quantized.imageData, 0, 0);

    const dataUrl = finalCanvas.toDataURL("image/png");
    const blob = await new Promise(resolve => finalCanvas.toBlob(resolve, "image/png"));

    return {
        size,
        width: size,
        height: size,
        dataUrl,
        blob,
        eyes,
        palette: quantized.palette,
    };
}

function loadImage(source) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = source;
    });
}

function applyMedianFilter(imageData) {
    const { width, height, data } = imageData;
    const filtered = new Uint8ClampedArray(data.length);
    const alphaThreshold = 20;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx + 3] <= alphaThreshold) {
                filtered[idx] = data[idx];
                filtered[idx + 1] = data[idx + 1];
                filtered[idx + 2] = data[idx + 2];
                filtered[idx + 3] = data[idx + 3];
                continue;
            }

            const reds = [];
            const greens = [];
            const blues = [];
            const alphas = [];

            for (let oy = -1; oy <= 1; oy++) {
                const ny = y + oy;
                if (ny < 0 || ny >= height) continue;
                for (let ox = -1; ox <= 1; ox++) {
                    const nx = x + ox;
                    if (nx < 0 || nx >= width) continue;
                    const nIdx = (ny * width + nx) * 4;
                    reds.push(data[nIdx]);
                    greens.push(data[nIdx + 1]);
                    blues.push(data[nIdx + 2]);
                    alphas.push(data[nIdx + 3]);
                }
            }

            filtered[idx] = median(reds);
            filtered[idx + 1] = median(greens);
            filtered[idx + 2] = median(blues);
            filtered[idx + 3] = median(alphas);
        }
    }

    return new ImageData(filtered, width, height);
}

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function addEyesToPixelArt(pixels, width = 16, height = 16) {
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const alpha = pixels[idx + 3];
            if (alpha > 20) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    }

    if (minX > maxX) {
        minX = 4; maxX = 12;
        minY = 4; maxY = 12;
    }

    const eyeY = Math.floor(minY + (maxY - minY) * 0.6);
    const leftEyeX = Math.floor(minX + (maxX - minX) * 0.25);
    const rightEyeX = Math.floor(minX + (maxX - minX) * 0.75);

    return {
        left: {
            pupil: { x: leftEyeX, y: eyeY },
            highlight: { x: leftEyeX + 1, y: eyeY },
        },
        right: {
            pupil: { x: rightEyeX - 1, y: eyeY },
            highlight: { x: rightEyeX, y: eyeY },
        },
        centerY: eyeY,
        bounds: { minX, maxX, minY, maxY },
    };
}

function applyPaletteQuantization(imageData, paletteSize = 16) {
    const { width, height, data } = imageData;
    const alphaThreshold = 20;
    const opaqueColors = [];

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > alphaThreshold) {
            opaqueColors.push([data[i], data[i + 1], data[i + 2]]);
        }
    }

    if (!opaqueColors.length) {
        return { imageData, palette: [] };
    }

    const unique = new Map();
    opaqueColors.forEach(([r, g, b]) => {
        unique.set(`${r},${g},${b}`, [r, g, b]);
    });

    const k = Math.min(paletteSize, Math.max(1, unique.size));
    const palette = lightenSaturatePalette(kMeansPalette(Array.from(unique.values()), k));

    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a <= alphaThreshold) {
            output[i] = data[i];
            output[i + 1] = data[i + 1];
            output[i + 2] = data[i + 2];
            output[i + 3] = data[i + 3];
            continue;
        }
        const nearest = nearestColor(palette, data[i], data[i + 1], data[i + 2]);
        output[i] = nearest[0];
        output[i + 1] = nearest[1];
        output[i + 2] = nearest[2];
        output[i + 3] = a;
    }

    return { imageData: new ImageData(output, width, height), palette };
}

function nearestColor(palette, r, g, b) {
    let best = palette[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const color of palette) {
        const dr = color[0] - r;
        const dg = color[1] - g;
        const db = color[2] - b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            best = color;
        }
    }
    return best;
}

function kMeansPalette(colors, k, maxIter = 12) {
    const n = colors.length;
    if (k >= n) return colors.slice(0, k);

    const centers = [];
    const used = new Set();
    while (centers.length < k) {
        const idx = Math.floor(Math.random() * n);
        if (!used.has(idx)) {
            used.add(idx);
            centers.push(colors[idx].slice());
        }
    }

    let assignments = new Array(n).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        for (let i = 0; i < n; i++) {
            const [r, g, b] = colors[i];
            let best = 0;
            let bestDist = Number.POSITIVE_INFINITY;
            for (let c = 0; c < k; c++) {
                const dr = centers[c][0] - r;
                const dg = centers[c][1] - g;
                const db = centers[c][2] - b;
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = c;
                }
            }
            if (assignments[i] !== best) {
                assignments[i] = best;
                changed = true;
            }
        }

        const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
        for (let i = 0; i < n; i++) {
            const cluster = assignments[i];
            sums[cluster][0] += colors[i][0];
            sums[cluster][1] += colors[i][1];
            sums[cluster][2] += colors[i][2];
            sums[cluster][3] += 1;
        }

        for (let c = 0; c < k; c++) {
            const count = Math.max(1, sums[c][3]);
            centers[c][0] = Math.round(sums[c][0] / count);
            centers[c][1] = Math.round(sums[c][1] / count);
            centers[c][2] = Math.round(sums[c][2] / count);
        }

        if (!changed) break;
    }

    return centers;
}

function lightenSaturatePalette(palette) {
    return palette.map(([r, g, b]) => {
        const { h, s, l } = rgbToHsl(r, g, b);
        const nl = l; // keep original lightness (no +10% brightening)
        const ns = Math.min(1, s * 1.15);
        const { r: nr, g: ng, b: nb } = hslToRgb(h, ns, nl);
        return [nr, ng, nb];
    });
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, l };
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
