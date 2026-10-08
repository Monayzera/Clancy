export interface NativeGlassRegion {
  id: string
  x: number
  y: number
  width: number
  height: number
  radius: number
  alpha: number
  style: number
  appearance: number
  variant: number
  tint: [number, number, number, number] | null
}

export function isSupported(): boolean
export function setRegions(windowHandle: Buffer, regions: NativeGlassRegion[]): void
export function sampleBackdrop(windowHandle: Buffer, rect: { x: number; y: number; width: number; height: number }): Promise<number | null>
