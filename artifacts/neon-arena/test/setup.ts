/**
 * Headless environment for the game engine.
 *
 * The simulation itself is pure maths, but `GameEngine` builds a renderer, a
 * post-processing chain and an environment map in its constructor. None of
 * that can exist under Node: jsdom has no WebGL and the machine has no GPU.
 *
 * Rather than drive a software-rendered browser -- minutes per run, and it
 * still cannot report on internal state -- the two GPU-owning Three.js classes
 * are replaced with headless stand-ins. Everything else (Vector3, Box3, Ray,
 * Sphere, the whole scene graph, the bloom chain) is the real library, so the
 * code under test is the code that ships.
 */
import type * as THREE from 'three';
import { vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  /**
   * Implements only what the engine and the post-processing passes ask of a
   * renderer. Anything that would touch a GL context is a no-op.
   */
  class HeadlessWebGLRenderer {
    readonly domElement: HTMLCanvasElement;
    readonly capabilities = { isWebGL2: true, maxTextureSize: 4096 };
    readonly shadowMap = { enabled: false, type: actual.PCFShadowMap };
    toneMapping: THREE.ToneMapping = actual.NoToneMapping;
    toneMappingExposure = 1;
    outputColorSpace = actual.SRGBColorSpace;
    /** The post-processing passes save and restore this around every render. */
    autoClear = true;

    private pixelRatio = 1;
    private width = 1280;
    private height = 720;
    private readonly clearColor = new actual.Color(0x000000);
    private clearAlpha = 0;

    constructor(parameters: { canvas?: HTMLCanvasElement } = {}) {
      this.domElement = parameters.canvas ?? document.createElement('canvas');
    }

    setPixelRatio(value: number): void {
      this.pixelRatio = value;
    }

    getPixelRatio(): number {
      return this.pixelRatio;
    }

    setSize(width: number, height: number): void {
      this.width = width;
      this.height = height;
    }

    getSize<T extends { set: (x: number, y: number) => unknown }>(target: T): T {
      target.set(this.width, this.height);
      return target;
    }

    getContext(): null {
      return null;
    }

    getRenderTarget(): null {
      return null;
    }

    /* The bloom and output passes swap the clear colour around their own
     * draws and put it back, so the stand-in has to actually remember it. */
    getClearColor<T extends THREE.Color>(target: T): T {
      target.copy(this.clearColor);
      return target;
    }

    getClearAlpha(): number {
      return this.clearAlpha;
    }

    setClearColor(color: THREE.ColorRepresentation, alpha = 1): void {
      this.clearColor.set(color);
      this.clearAlpha = alpha;
    }

    setRenderTarget(): void {}
    clear(): void {}
    clearDepth(): void {}
    render(): void {}
    dispose(): void {}
  }

  /** The engine only wants `.fromScene(...).texture` and `.dispose()`. */
  class HeadlessPMREMGenerator {
    fromScene(): { texture: THREE.Texture } {
      return { texture: new actual.Texture() };
    }

    dispose(): void {}
  }

  return {
    ...actual,
    WebGLRenderer: HeadlessWebGLRenderer,
    PMREMGenerator: HeadlessPMREMGenerator,
  };
});

/**
 * jsdom ships no 2D canvas backend. Both callers of `getContext('2d')` in the
 * game already handle a null context (they emit a blank texture), so returning
 * null is the honest answer -- and it keeps jsdom from logging a
 * "not implemented" stack for every damage number the tests produce.
 */
HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as HTMLCanvasElement['getContext'];

/** Pointer lock is meaningless headlessly, but `start()` asks for it. */
HTMLCanvasElement.prototype.requestPointerLock = (() =>
  undefined) as unknown as HTMLCanvasElement['requestPointerLock'];
(document as { exitPointerLock: () => void }).exitPointerLock = () => undefined;

/**
 * The engine schedules its own render loop from the constructor. Tests advance
 * the world by calling `simulate()` a fixed number of times, so a self-driving
 * loop would inject non-deterministic extra steps between assertions.
 */
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => undefined;
