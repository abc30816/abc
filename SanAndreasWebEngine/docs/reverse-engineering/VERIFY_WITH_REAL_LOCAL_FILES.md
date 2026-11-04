# Optional local verification (keep game data out of Git)

The ZIP does not contain game data. To verify your own local installation in the browser, use the existing folder-picker `Map<string, File>`:

```ts
import { loadVehicleCatalogFromFiles } from './src/config/vehicleCatalog';

const { handling, vehicles, catalog } = await loadVehicleCatalogFromFiles(game.files);
console.table([...catalog.byModelId.values()].slice(0, 8).map((v) => ({
  id: v.modelId,
  model: v.modelName,
  type: v.vehicleType,
  handling: v.handlingId,
  massKg: v.handling.mass,
  maxVelocityKmh: v.handling.maxVelocity,
})));
console.warn('handling issues', handling.issues);
console.warn('vehicles.ide issues', vehicles.issues);
console.warn('cross-reference issues', catalog.issues);
```

Do not replace the existing game folder loader with a network upload. These parsers read `Blob` objects already selected by the user and return parsed values in browser memory.
