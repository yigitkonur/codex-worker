export interface ReleaseTarget {
  id: string;
  bunTarget: string;
  outputName: string;
  bytecode: boolean;
}

export const RELEASE_TARGETS: ReadonlyArray<ReleaseTarget>;

export function shouldUseHostBytecode(): boolean;

export function main(argv?: string[]): void;
