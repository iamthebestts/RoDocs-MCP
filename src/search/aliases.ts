export const ROBLOX_ALIASES: Record<string, string[]> = {
  // DataStore
  datastore: ["DataStore", "DataStoreService", "GlobalDataStore"],
  "data store": ["DataStoreService"],
  ds: ["DataStore", "DataStoreService", "GlobalDataStore"],
  datastoreservice: ["DataStoreService"],
  "ordered datastore": ["OrderedDataStore"],
  globalstore: ["GlobalDataStore"],

  // MemoryStore
  memorystore: ["MemoryStoreService"],
  "memory store": ["MemoryStoreService"],
  memorystoreservice: ["MemoryStoreService"],
  memoryqueue: ["MemoryStoreQueue"],
  memorysortedmap: ["MemoryStoreSortedMap"],

  // Remotes
  remote: ["RemoteEvent", "RemoteFunction", "UnreliableRemoteEvent"],
  remoteevent: ["RemoteEvent"],
  "remote event": ["RemoteEvent"],
  remotefunction: ["RemoteFunction"],
  "remote function": ["RemoteFunction"],
  bindableevent: ["BindableEvent"],
  "bindable event": ["BindableEvent"],
  bindablefunction: ["BindableFunction"],
  "bindable function": ["BindableFunction"],
  unreliableremote: ["UnreliableRemoteEvent"],

  // Tween
  tween: ["TweenService", "Tween", "TweenInfo"],
  tweenservice: ["TweenService"],
  tweeninfo: ["TweenInfo"],

  // Pathfinding
  pathfinding: ["PathfindingService", "Path", "PathWaypoint"],
  pathfindingservice: ["PathfindingService"],
  navmesh: ["PathfindingService"],

  // Marketplace
  marketplace: ["MarketplaceService"],
  marketplaceservice: ["MarketplaceService"],
  gamepass: ["MarketplaceService"],
  "developer product": ["MarketplaceService"],

  // Players
  players: ["Players"],
  player: ["Player"],
  localplayer: ["Players"],

  // Workspace
  workspace: ["Workspace"],
  world: ["Workspace"],

  // RunService
  runservice: ["RunService"],
  heartbeat: ["RunService"],
  renderstepped: ["RunService"],
  stepped: ["RunService"],
  "run service": ["RunService"],

  // UserInputService
  userinputservice: ["UserInputService"],
  input: ["UserInputService"],
  keyboard: ["UserInputService"],
  mouse: ["UserInputService"],
  touch: ["UserInputService"],
  "user input": ["UserInputService"],

  // Humanoid
  humanoid: ["Humanoid"],
  character: ["Character", "Humanoid", "HumanoidRootPart"],
  char: ["Character", "Humanoid", "HumanoidRootPart"],
  health: ["Humanoid"],
  walkspeed: ["Humanoid"],

  // BasePart
  basepart: ["BasePart"],
  part: ["BasePart", "MeshPart", "Part", "WedgePart", "SpawnLocation"],
  meshpart: ["MeshPart"],
  unionoperation: ["UnionOperation"],
  specialmesh: ["SpecialMesh"],

  // Physics
  physics: ["PhysicsService", "CollisionGroup", "BasePart:ApplyImpulse"],
  bodyvelocity: ["BodyVelocity"],
  bodygyro: ["BodyGyro"],
  bodyposition: ["BodyPosition"],
  constraint: ["Constraint"],
  weld: ["WeldConstraint"],
  hinge: ["HingeConstraint"],

  // Lighting
  lighting: ["Lighting", "Atmosphere", "Sky", "ColorCorrectionEffect"],
  sky: ["Sky"],
  atmosphere: ["Atmosphere"],
  bloom: ["BloomEffect"],

  // Sound
  sound: ["Sound", "SoundService", "SoundGroup"],
  soundservice: ["SoundService"],

  // Collections
  collectionservice: ["CollectionService"],
  tag: ["CollectionService"],
  tags: ["CollectionService"],

  // HTTP
  httpservice: ["HttpService"],
  http: ["HttpService"],
  json: ["HttpService"],

  // Text / Chat
  textservice: ["TextService"],
  chat: ["TextChatService"],
  textchat: ["TextChatService"],

  // Camera
  camera: ["Camera", "Workspace.CurrentCamera"],
  cam: ["Camera", "Workspace.CurrentCamera"],
  viewport: ["Camera"],

  // GUI
  gui: ["ScreenGui", "SurfaceGui", "BillboardGui", "GuiObject"],
  screengui: ["ScreenGui"],
  surfacegui: ["SurfaceGui"],
  billboardgui: ["BillboardGui"],
  frame: ["Frame"],
  textlabel: ["TextLabel"],
  textbutton: ["TextButton"],
  imagelabel: ["ImageLabel"],
  imagebutton: ["ImageButton"],
  scrollingframe: ["ScrollingFrame"],

  // Animation
  animate: ["Animation", "AnimationTrack", "Animator"],
  animation: ["Animation", "AnimationTrack", "Animator"],
  animator: ["Animator"],
  animationtrack: ["AnimationTrack"],

  // Spatial queries
  cframe: ["CFrame", "CoordinateFrame"],
  raycast: ["Raycast", "RaycastParams", "RaycastResult", "workspace:Raycast"],

  // Parallel Luau
  parallel: ["Actor", "SharedTable", "task.desynchronize"],

  // Misc
  debris: ["Debris"],
  teams: ["Teams"],
  team: ["Team"],
};

const NORMALIZED: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>(
  Object.entries(ROBLOX_ALIASES).map(([key, values]) => [key.toLowerCase(), values]),
);

export function resolveAliases(query: string): readonly string[] {
  const lower = query.toLowerCase().trim();
  return NORMALIZED.get(lower) ?? [];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expandQuery(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [query];

  const expanded = new Set<string>([query]);
  const lower = trimmed.toLowerCase();

  for (const [alias, replacements] of NORMALIZED) {
    const pattern = new RegExp(`(^|\\s)${escapeRegex(alias)}(?=\\s|$)`, "i");
    if (!pattern.test(lower)) continue;

    for (const replacement of replacements) {
      expanded.add(trimmed.replace(pattern, (_match, prefix: string) => `${prefix}${replacement}`));
    }
  }

  return [...expanded];
}

// ! Luau synonyms

const LUAU_SYNONYMS: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ["task.wait", "task"],
  ["task.delay", "task"],
  [":waitforchild", "Instance"],
  [":findfirstchild", "Instance"],
  [":connect", "RBXScriptSignal"],
  ["game:getservice", null], // pass-through: return query unchanged
]);

/**
 * Replaces common Luau syntax with the canonical API name.
 * "game:getservice" is pass-through — returns the original query.
 */
export function resolveLuauSynonyms(query: string): string {
  const lower = query.toLowerCase().trim();
  const entry = LUAU_SYNONYMS.get(lower);
  if (entry === undefined || entry === null) return query;
  return entry;
}
