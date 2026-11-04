/** Joins vehicles.ide records to handling.cfg rows and their specialized extensions. */
import { parseHandlingCfgFromFiles, type HandlingExtension, type HandlingCfgResult, type VehicleHandling } from './handlingCfg';
import { parseVehiclesIdeFromFiles, type VehicleIdeResult } from './vehiclesIde';

export interface VehicleCatalogIssue {
  sourceLine: number;
  sourceFile: 'vehicles.ide' | 'handling.cfg';
  severity: 'warning' | 'error';
  message: string;
}
export interface VehicleCatalogEntry {
  modelId: number;
  modelName: string;
  txdName: string;
  vehicleType: string;
  handlingId: string;
  gameName: string;
  animationName: string;
  vehicleClass: string;
  frequency: number;
  flags: number;
  componentRules: string;
  extraFields: readonly string[];
  handling: VehicleHandling;
  boatHandling?: HandlingExtension;
  bikeHandling?: HandlingExtension;
  flyingHandling?: HandlingExtension;
  animationGroupData?: HandlingExtension;
}
export interface VehicleCatalogResult {
  byModelId: Map<number, VehicleCatalogEntry>;
  byModelName: Map<string, VehicleCatalogEntry>;
  issues: VehicleCatalogIssue[];
  unreferencedHandlingIds: string[];
}

export function buildVehicleCatalog(vehicles: VehicleIdeResult, handling: HandlingCfgResult): VehicleCatalogResult {
  const issues: VehicleCatalogIssue[] = [];
  const byModelId = new Map<number, VehicleCatalogEntry>();
  const byModelName = new Map<string, VehicleCatalogEntry>();
  const referenced = new Set<string>();
  const extensionMap = new Map<string, HandlingExtension>();
  for (const extension of handling.extensions) extensionMap.set(`${extension.kind}:${extension.id.toUpperCase()}`, extension);

  for (const vehicle of vehicles.vehicles) {
    const key = vehicle.handlingId.toLowerCase();
    const baseHandling = handling.vehicles.get(key);
    if (!baseHandling) {
      issues.push({ sourceLine: vehicle.sourceLine, sourceFile: 'vehicles.ide', severity: 'error', message: `Model ${vehicle.modelId} (${vehicle.modelName}) references missing handling ID ${vehicle.handlingId}.` });
      continue;
    }
    referenced.add(key);
    const extension = (kind: HandlingExtension['kind'], id: string): HandlingExtension | undefined => extensionMap.get(`${kind}:${id.toUpperCase()}`);
    const entry: VehicleCatalogEntry = {
      modelId: vehicle.modelId,
      modelName: vehicle.modelName,
      txdName: vehicle.txdName,
      vehicleType: vehicle.vehicleType,
      handlingId: vehicle.handlingId,
      gameName: vehicle.gameName,
      animationName: vehicle.animationName,
      vehicleClass: vehicle.vehicleClass,
      frequency: vehicle.frequency,
      flags: vehicle.flags,
      componentRules: vehicle.componentRules,
      extraFields: vehicle.extraFields,
      handling: baseHandling,
      boatHandling: extension('boat', vehicle.handlingId),
      bikeHandling: extension('bike', vehicle.handlingId),
      flyingHandling: extension('flying', vehicle.handlingId),
      animationGroupData: extension('animation', String(baseHandling.animationGroup)),
    };
    if (byModelId.has(entry.modelId)) {
      issues.push({ sourceLine: vehicle.sourceLine, sourceFile: 'vehicles.ide', severity: 'error', message: `Duplicate model ID ${entry.modelId}; first definition kept.` });
      continue;
    }
    byModelId.set(entry.modelId, entry);
    const modelKey = entry.modelName.toLowerCase();
    if (byModelName.has(modelKey)) {
      issues.push({ sourceLine: vehicle.sourceLine, sourceFile: 'vehicles.ide', severity: 'warning', message: `Duplicate model name ${entry.modelName}; model-ID map remains authoritative.` });
    } else {
      byModelName.set(modelKey, entry);
    }
  }

  const unreferencedHandlingIds: string[] = [];
  for (const [key, record] of handling.vehicles) {
    if (referenced.has(key)) continue;
    unreferencedHandlingIds.push(record.vehicleId);
    issues.push({ sourceLine: record.sourceLine, sourceFile: 'handling.cfg', severity: 'warning', message: `Handling ID ${record.vehicleId} is not referenced by any valid vehicles.ide row.` });
  }
  return { byModelId, byModelName, issues, unreferencedHandlingIds };
}

export function findVehicleByModelId(catalog: VehicleCatalogResult, modelId: number): VehicleCatalogEntry | undefined {
  return catalog.byModelId.get(modelId);
}

export function vehicleCatalogToSummary(catalog: VehicleCatalogResult): {
  vehicleCount: number;
  boatCount: number;
  bikeCount: number;
  flyingCount: number;
  vehiclesWithAnimationGroupData: number;
  errorCount: number;
  warningCount: number;
} {
  let boatCount = 0;
  let bikeCount = 0;
  let flyingCount = 0;
  let animationGroupCount = 0;
  for (const entry of catalog.byModelId.values()) {
    if (entry.boatHandling) boatCount += 1;
    if (entry.bikeHandling) bikeCount += 1;
    if (entry.flyingHandling) flyingCount += 1;
    if (entry.animationGroupData) animationGroupCount += 1;
  }
  return {
    vehicleCount: catalog.byModelId.size,
    boatCount,
    bikeCount,
    flyingCount,
    vehiclesWithAnimationGroupData: animationGroupCount,
    errorCount: catalog.issues.filter((issue) => issue.severity === 'error').length,
    warningCount: catalog.issues.filter((issue) => issue.severity === 'warning').length,
  };
}

/** Load both configuration files from an already-selected local game File map. */
export async function loadVehicleCatalogFromFiles(files: ReadonlyMap<string, Blob>): Promise<{ handling: HandlingCfgResult; vehicles: VehicleIdeResult; catalog: VehicleCatalogResult }> {
  const [handling, vehicles] = await Promise.all([
    parseHandlingCfgFromFiles(files),
    parseVehiclesIdeFromFiles(files),
  ]);
  return { handling, vehicles, catalog: buildVehicleCatalog(vehicles, handling) };
}
