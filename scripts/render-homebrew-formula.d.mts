export interface HomebrewFormulaInput {
  version: string;
  repoSlug: string;
  description: string;
  homepage: string;
  license: string;
  sha256: {
    darwinX64: string;
    darwinArm64: string;
    linuxX64: string;
    linuxArm64: string;
  };
}

export function renderHomebrewFormula(input: HomebrewFormulaInput): string;
