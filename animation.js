const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class TamagotchiAnimator {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.ctx.imageSmoothingEnabled = false;
        this.width = canvas.width;
        this.height = canvas.height;
        this.mode = "calm";
        this.basePixels = null;
        this.bodyPixels = null;
        this.bounds = null;
        this.eyes = null;
        this.frameBuffer = null;
        this.outputImageData = null;
        this.running = false;
        this.lastTimestamp = 0;
        this.tearPhase = 0;
        this.tearPeriod = 1600;
        this.winkState = { active: false, next: 0, duration: 140 };
        this.sleepElapsed = 0;
        this.sleepDuration = 4000;
        this.edgePixels = [];
    }

    setSprite({ imageData, eyes }) {
        if (!imageData) {
            this.bodyPixels = null;
            this.eyes = null;
            this.clearCanvas();
            return;
        }

        this.width = imageData.width;
        this.height = imageData.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx.imageSmoothingEnabled = false;

        this.basePixels = new Uint8ClampedArray(imageData.data);
        // keep original eyes in place; animations draw over the existing pixels
        this.bodyPixels = new Uint8ClampedArray(this.basePixels);
        this.eyes = eyes || null;
        this.bounds = eyes?.bounds || this.computeBounds(this.bodyPixels, this.width, this.height);

        this.edgePixels = this.computeEdgePixels();

        const total = this.width * this.height * 4;
        this.frameBuffer = new Uint8ClampedArray(total);
        this.outputImageData = new ImageData(this.width, this.height);

        this.tearPhase = 0;
        this.sleepElapsed = 0;
        this.sleepDuration = 3000 + Math.random() * 2000;
        this.scheduleNextWink(performance.now());
        this.ensureRunning();
    }

    setMode(mode) {
        this.mode = mode || "calm";
    }

    ensureRunning() {
        if (this.running) return;
        this.running = true;
        this.lastTimestamp = performance.now();
        requestAnimationFrame(this.loop);
    }

    stop() {
        this.running = false;
    }

    clearCanvas() {
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    loop = (timestamp) => {
        if (!this.running) return;
        const delta = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;
        this.render(timestamp, delta);
        requestAnimationFrame(this.loop);
    };

    render(timestamp, delta) {
        if (!this.bodyPixels) {
            this.clearCanvas();
            return;
        }

        switch (this.mode) {
            case "excited":
                this.renderExcited(timestamp);
                break;
            case "happy":
                this.renderHappy(timestamp);
                break;
            case "sad":
                this.renderSad(delta);
                break;
            case "wink":
                this.renderWink(timestamp);
                break;
            case "sleepy":
                this.renderSleepy(delta);
                break;
            case "calm":
            default:
                this.renderCalm(timestamp);
                break;
        }
    }

    // 4.1 Calm: body static, eyes slowly swap left/right (black + white)
    renderCalm(timestamp) {
        const frame = this.prepareFrameWithBody();
        const direction = this.computeEyeDirection(timestamp, 3200);
        this.drawFacingEyes(frame, direction);
        this.commitFrame(frame);
    }

    // 4.2 Excited: vertical stretch with bottom anchored
    renderExcited(timestamp) {
        const frame = this.prepareEmptyFrame();
        const period = 420; // gentle bounce
        const stretch = 1 + 0.14 * Math.sin((timestamp % period) / period * Math.PI * 2);
        const transform = this.drawAnchoredVerticalStretch(frame, stretch);
        const direction = this.computeEyeDirection(timestamp, 3200);
        this.drawFacingEyes(frame, direction, transform);
        this.commitFrame(frame);
    }

    // 4.3 Happy: small horizontal bounce, eyes follow calm direction
    renderHappy(timestamp) {
        const frame = this.prepareEmptyFrame();
        const offset = Math.round((Math.sin(timestamp / 550 * 2 * Math.PI) + 1) / 2); // 0 or 1 px
        const transform = this.drawBodyWithOffset(frame, offset, 0);
        const direction = this.computeEyeDirection(timestamp, 3200);
        this.drawFacingEyes(frame, direction, transform);
        this.commitFrame(frame);
    }

    // 4.4 Sad: edge shake + dual tear drops
    renderSad(delta) {
        const frame = this.prepareFrameWithBody();
        this.overlayEdgeShake(frame);
        this.drawSadEyesAndTears(frame, delta);
        this.commitFrame(frame);
    }

    // 4.5 Wink: black-only eyes, right eye compresses briefly
    renderWink(timestamp) {
        const frame = this.prepareFrameWithBody();
        this.updateWinkState(timestamp);
        const { leftX, rightX, baseY } = this.getSimpleEyeLayout(true);
        // left eye stays 2px
        this.drawVerticalEyeLine(frame, leftX, baseY, 2);
        // right eye sometimes shrinks to 1px at bottom
        if (this.winkState.active) {
            this.restoreBodyPixel(frame, rightX, baseY);
            this.setPixel(frame, rightX, clamp(baseY + 1, 0, this.height - 1), BLACK);
        } else {
            this.drawVerticalEyeLine(frame, rightX, baseY, 2);
        }
        this.commitFrame(frame);
    }

    // 4.6 Sleepy: black-only eyes, top pixel fades out then snaps back
    renderSleepy(delta) {
        const frame = this.prepareFrameWithBody();
        const { leftX, rightX, baseY } = this.getSimpleEyeLayout(true);

        this.sleepElapsed += delta;
        if (this.sleepElapsed >= this.sleepDuration) {
            this.sleepElapsed %= this.sleepDuration;
            this.sleepDuration = 3000 + Math.random() * 2000;
        }
        const phase = this.sleepElapsed / this.sleepDuration;
        const opacity = this.computeSleepyOpacity(phase);

        this.drawSleepyEye(frame, leftX, baseY, opacity);
        this.drawSleepyEye(frame, rightX, baseY, opacity);
        this.commitFrame(frame);
    }

    prepareFrameWithBody() {
        const frame = this.ensureFrameBuffer();
        frame.set(this.bodyPixels);
        return frame;
    }

    prepareEmptyFrame() {
        const frame = this.ensureFrameBuffer();
        frame.fill(0);
        return frame;
    }

    ensureFrameBuffer() {
        if (!this.frameBuffer || this.frameBuffer.length !== this.bodyPixels.length) {
            this.frameBuffer = new Uint8ClampedArray(this.bodyPixels.length);
        }
        return this.frameBuffer;
    }

    commitFrame(frame) {
        if (!this.outputImageData || this.outputImageData.width !== this.width) {
            this.outputImageData = new ImageData(this.width, this.height);
        }
        this.outputImageData.data.set(frame);
        this.ctx.putImageData(this.outputImageData, 0, 0);
    }

    computeEyeDirection(timestamp, period) {
        const wave = Math.sin(timestamp / period * Math.PI * 2);
        return wave >= 0 ? "left" : "right";
    }

    drawFacingEyes(frame, direction, transform = {}) {
        if (!this.eyes) return;
        const { left, right } = this.transformEyes(transform);
        this.paintEye(frame, left, direction);
        this.paintEye(frame, right, direction);
    }

    paintEye(frame, eye, direction) {
        if (!eye) return;
        if (direction === "right") {
            this.setPixel(frame, eye.highlight.x, eye.highlight.y, BLACK);
            this.setPixel(frame, eye.pupil.x, eye.pupil.y, WHITE);
        } else {
            this.setPixel(frame, eye.pupil.x, eye.pupil.y, BLACK);
            this.setPixel(frame, eye.highlight.x, eye.highlight.y, WHITE);
        }
    }

    drawSadEyesAndTears(frame, delta) {
        const layout = this.getSimpleEyeLayout();
        const leftEye = this.getEyePosition("left", layout);
        const rightEye = this.getEyePosition("right", layout);

        // eyes: horizontal pair black (left) + white (right)
        const paintEyePair = eye => {
            if (!eye) return;
            const whiteX = clamp(eye.x + 1, 0, this.width - 1);
            this.setPixel(frame, eye.x, eye.y, BLACK);
            this.setPixel(frame, whiteX, eye.y, WHITE);
            return { x: eye.x, y: eye.y };
        };

        const leftAnchor = paintEyePair(leftEye) || leftEye;
        const rightAnchor = paintEyePair(rightEye) || rightEye;

        // update tear phase
        this.tearPhase = (this.tearPhase + delta / this.tearPeriod) % 1;
        const dropProgress = this.tearPhase < 0.9 ? this.tearPhase / 0.9 : 0;

        ["left", "right"].forEach(side => {
            const eye = side === "left" ? leftAnchor : rightAnchor;
            if (!eye) return;
            const startY = clamp(eye.y + 1, 0, this.height - 1);
            const endY = clamp(this.bounds.maxY, 0, this.height - 1);
            const tearY = this.tearPhase < 0.9 ? Math.round(startY + (endY - startY) * dropProgress) : startY;
            this.setPixel(frame, eye.x, tearY, WHITE);
        });
    }

    drawVerticalEyeLine(frame, column, baseY, length) {
        for (let i = 0; i < length; i++) {
            const y = clamp(baseY + i, 0, this.height - 1);
            this.setPixel(frame, column, y, BLACK);
        }
    }

    drawSleepyEye(frame, x, baseY, opacity) {
        const bottomY = clamp(baseY + 1, 0, this.height - 1);
        this.setPixel(frame, x, bottomY, BLACK);

        const topY = clamp(baseY, 0, this.height - 1);
        if (opacity <= 0) {
            this.restoreBodyPixel(frame, x, topY);
            return;
        }
        if (opacity >= 1) {
            this.setPixel(frame, x, topY, BLACK);
            return;
        }
        const baseColor = this.getBodyPixel(x, topY);
        const mix = (from, to) => Math.round(from * (1 - opacity) + to * opacity);
        this.setPixel(frame, x, topY, [mix(baseColor[0], 0), mix(baseColor[1], 0), mix(baseColor[2], 0), 255]);
    }

    computeSleepyOpacity(phase) {
        if (phase < 0.7) {
            return 1 - phase / 0.7; // fade out
        }
        if (phase < 0.85) {
            return 0; // hold closed
        }
        return 1; // snap open
    }

    updateWinkState(timestamp) {
        if (timestamp >= this.winkState.next) {
            this.winkState.active = true;
            this.winkState.endsAt = timestamp + this.winkState.duration;
            this.scheduleNextWink(this.winkState.endsAt);
        }
        if (this.winkState.active && timestamp >= this.winkState.endsAt) {
            this.winkState.active = false;
        }
    }

    scheduleNextWink(baseTimestamp) {
        const delay = 1000 + Math.random() * 1000; // 1–2s
        this.winkState.next = baseTimestamp + delay;
    }

    drawBodyWithOffset(frame, offsetX, offsetY) {
        const width = this.width;
        const height = this.height;
        const source = this.bodyPixels;
        for (let y = 0; y < height; y++) {
            const ny = y + offsetY;
            if (ny < 0 || ny >= height) continue;
            for (let x = 0; x < width; x++) {
                const nx = x + offsetX;
                if (nx < 0 || nx >= width) continue;
                const srcIdx = (y * width + x) * 4;
                const alpha = source[srcIdx + 3];
                if (!alpha) continue;
                const destIdx = (ny * width + nx) * 4;
                frame[destIdx] = source[srcIdx];
                frame[destIdx + 1] = source[srcIdx + 1];
                frame[destIdx + 2] = source[srcIdx + 2];
                frame[destIdx + 3] = alpha;
            }
        }
        return { offsetX, offsetY };
    }

    drawAnchoredVerticalStretch(frame, scale) {
        const width = this.width;
        const base = this.bodyPixels;
        const { minX, maxX, minY, maxY } = this.bounds;
        const bodyHeight = Math.max(1, maxY - minY + 1);
        const newHeight = clamp(Math.round(bodyHeight * scale), 1, this.height);
        const targetMaxY = maxY;
        const targetMinY = clamp(targetMaxY - newHeight + 1, 0, this.height - newHeight);

        for (let x = minX; x <= maxX; x++) {
            for (let step = 0; step < newHeight; step++) {
                const destY = targetMinY + step;
                const ratio = newHeight === 1 ? 0 : step / (newHeight - 1);
                const sourceY = minY + ratio * (bodyHeight - 1);
                const y0 = Math.floor(sourceY);
                const y1 = Math.min(maxY, y0 + 1);
                const t = sourceY - y0;
                const idx0 = (y0 * width + x) * 4;
                const idx1 = (y1 * width + x) * 4;
                const alpha0 = base[idx0 + 3];
                const alpha1 = base[idx1 + 3];
                if (!alpha0 && !alpha1) continue;
                const mix = (a, b) => Math.round(a * (1 - t) + b * t);
                const destIdx = (destY * width + x) * 4;
                frame[destIdx] = mix(base[idx0], base[idx1]);
                frame[destIdx + 1] = mix(base[idx0 + 1], base[idx1 + 1]);
                frame[destIdx + 2] = mix(base[idx0 + 2], base[idx1 + 2]);
                frame[destIdx + 3] = mix(alpha0, alpha1);
            }
        }

        return { stretch: { minY: targetMinY, height: newHeight } };
    }

    transformEyes(transform = {}) {
        if (!this.eyes) return {};
        return {
            left: this.transformEye(this.eyes.left, transform),
            right: this.transformEye(this.eyes.right, transform),
        };
    }

    transformEye(eye, transform = {}) {
        if (!eye) return null;
        const offsetX = transform.offsetX || 0;
        const offsetY = transform.offsetY || 0;
        const pupilY = this.mapYWithTransform(eye.pupil.y, transform);
        const highlightY = this.mapYWithTransform(eye.highlight.y, transform);
        return {
            pupil: {
                x: clamp(Math.round(eye.pupil.x + offsetX), 0, this.width - 1),
                y: clamp(Math.round(pupilY + offsetY), 0, this.height - 1),
            },
            highlight: {
                x: clamp(Math.round(eye.highlight.x + offsetX), 0, this.width - 1),
                y: clamp(Math.round(highlightY + offsetY), 0, this.height - 1),
            },
        };
    }

    mapYWithTransform(y, transform = {}) {
        if (!transform.stretch) {
            return clamp(Math.round(y), 0, this.height - 1);
        }
        const bodyHeight = Math.max(1, this.bounds.maxY - this.bounds.minY + 1);
        const ratio = (y - this.bounds.minY) / bodyHeight;
        const mapped = transform.stretch.minY + ratio * (transform.stretch.height - 1);
        return clamp(Math.round(mapped), 0, this.height - 1);
    }

    getEyePosition(side, fallbackLayout) {
        if (this.eyes?.[side]?.pupil) {
            return {
                x: clamp(Math.round(this.eyes[side].pupil.x), 0, this.width - 1),
                y: clamp(Math.round(this.eyes[side].pupil.y), 0, this.height - 1),
            };
        }
        if (fallbackLayout) {
            const x = side === "left" ? fallbackLayout.leftX : fallbackLayout.rightX;
            return { x, y: fallbackLayout.baseY };
        }
        return null;
    }

    getSimpleEyeLayout(shiftTowardsCenter = false) {
        const { minX, maxX, minY, maxY } = this.bounds;
        const width = Math.max(1, maxX - minX);
        let leftX = clamp(minX + Math.floor(width * 0.25), 0, this.width - 1);
        let rightX = clamp(minX + Math.ceil(width * 0.75), 0, this.width - 1);
        if (leftX === rightX) {
            rightX = clamp(leftX + 2, 0, this.width - 1);
        }
        if (shiftTowardsCenter) {
            leftX = clamp(leftX + 1, 0, this.width - 1);
            rightX = clamp(rightX - 1, 0, this.width - 1);
            if (leftX >= rightX) {
                leftX = Math.max(0, leftX - 1);
                rightX = Math.min(this.width - 1, rightX + 1);
            }
        }
        const baseY = clamp(Math.round(minY + (maxY - minY) * 0.4), 0, this.height - 2);
        return { leftX, rightX, baseY };
    }

    setPixel(buffer, x, y, color) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        const idx = (y * this.width + x) * 4;
        buffer[idx] = color[0];
        buffer[idx + 1] = color[1];
        buffer[idx + 2] = color[2];
        buffer[idx + 3] = color[3];
    }

    getBodyPixel(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
            return [0, 0, 0, 0];
        }
        const idx = (y * this.width + x) * 4;
        return [
            this.bodyPixels[idx],
            this.bodyPixels[idx + 1],
            this.bodyPixels[idx + 2],
            this.bodyPixels[idx + 3],
        ];
    }

    restoreBodyPixel(frame, x, y) {
        const color = this.getBodyPixel(x, y);
        this.setPixel(frame, x, y, color);
    }

    computeEdgePixels() {
        if (!this.bodyPixels) return [];
        const width = this.width;
        const height = this.height;
        const pixels = this.bodyPixels;
        const edges = [];
        const neighborOffsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
        ];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                if (pixels[idx + 3] <= 20) continue;
                const isEdge = neighborOffsets.some(([ox, oy]) => {
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
                    const nIdx = (ny * width + nx) * 4;
                    return pixels[nIdx + 3] <= 20;
                });
                if (isEdge) {
                    edges.push({
                        x,
                        y,
                        color: [
                            pixels[idx],
                            pixels[idx + 1],
                            pixels[idx + 2],
                            pixels[idx + 3],
                        ],
                    });
                }
            }
        }
        return edges;
    }

    overlayEdgeShake(frame) {
        if (!this.edgePixels?.length) return;
        const jitter = () => Math.floor(Math.random() * 3) - 1; // -1,0,1
        this.edgePixels.forEach(edge => {
            const dx = jitter();
            const dy = jitter();
            const nx = clamp(edge.x + dx, 0, this.width - 1);
            const ny = clamp(edge.y + dy, 0, this.height - 1);
            this.setPixel(frame, nx, ny, edge.color);
        });
    }

    removeEyePixels() {
        const coords = [
            this.eyes?.left?.pupil,
            this.eyes?.left?.highlight,
            this.eyes?.right?.pupil,
            this.eyes?.right?.highlight,
        ];
        coords.forEach(point => {
            if (!point) return;
            const idx = (point.y * this.width + point.x) * 4;
            this.bodyPixels[idx] = 0;
            this.bodyPixels[idx + 1] = 0;
            this.bodyPixels[idx + 2] = 0;
            this.bodyPixels[idx + 3] = 0;
        });
    }

    computeBounds(pixels, width, height) {
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                if (pixels[idx + 3] > 20) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        if (minX > maxX) {
            minX = 4; maxX = 12; minY = 4; maxY = 12;
        }
        return { minX, maxX, minY, maxY };
    }
}
