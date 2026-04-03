export interface ModelCatalogInput {
  id: string;
  hidden: boolean;
  upgrade?: string | null | undefined;
}

export interface ModelAliasMapping {
  alias: string;
  canonical: string;
  reason: 'upgrade';
}

export interface ModelCatalog {
  visibleModelIds: string[];
  hiddenModelIds: string[];
  aliasMappings: ModelAliasMapping[];
}

export function buildModelCatalog(models: ModelCatalogInput[]): ModelCatalog {
  const visibleModelIds = models
    .filter((model) => !model.hidden)
    .map((model) => model.id)
    .sort((left, right) => left.localeCompare(right));

  const hiddenModelIds = models
    .filter((model) => model.hidden)
    .map((model) => model.id)
    .sort((left, right) => left.localeCompare(right));

  const aliasMappings = models
    .filter((model): model is ModelCatalogInput & { upgrade: string } => Boolean(model.upgrade))
    .map((model) => ({
      alias: model.id,
      canonical: model.upgrade!,
      reason: 'upgrade' as const,
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));

  return {
    visibleModelIds,
    hiddenModelIds,
    aliasMappings,
  };
}

export function resolveRequestedModel(
  requested: string,
  catalog: ModelCatalog,
): { resolved: string; remappedFrom?: string | undefined } | undefined {
  const alias = catalog.aliasMappings.find((mapping) => mapping.alias === requested);
  if (!alias) {
    if (catalog.visibleModelIds.includes(requested) || catalog.hiddenModelIds.includes(requested)) {
      return { resolved: requested };
    }
    return undefined;
  }

  return {
    resolved: alias.canonical,
    remappedFrom: requested,
  };
}

export function describeAllowedModels(catalog: ModelCatalog, includeHidden = false): string {
  const visible = catalog.visibleModelIds.join(', ');
  const hidden = includeHidden && catalog.hiddenModelIds.length > 0
    ? ` | hidden: ${catalog.hiddenModelIds.join(', ')}`
    : '';

  const aliases = catalog.aliasMappings.length > 0
    ? ` | aliases: ${catalog.aliasMappings.map((entry) => `${entry.alias} -> ${entry.canonical}`).join(', ')}`
    : '';

  return `Allowed models: ${visible}${hidden}${aliases}`;
}
