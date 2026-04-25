const ALIASES = {
  // DataStore
  datastore: ["DataStoreService"],
  "data store": ["DataStoreService"],
  ds: ["DataStoreService"],
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
  tween: ["TweenService", "Tween"],
  tweenservice: ["TweenService"],
  tweeninfo: ["TweenInfo"],

  // Pathfinding
  pathfinding: ["PathfindingService"],
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
  character: ["Humanoid"],
  health: ["Humanoid"],
  walkspeed: ["Humanoid"],

  // BasePart
  basepart: ["BasePart"],
  part: ["BasePart", "Part"],
  meshpart: ["MeshPart"],
  unionoperation: ["UnionOperation"],
  specialmesh: ["SpecialMesh"],

  // Physics
  bodyvelocity: ["BodyVelocity"],
  bodygyro: ["BodyGyro"],
  bodyposition: ["BodyPosition"],
  constraint: ["Constraint"],
  weld: ["WeldConstraint"],
  hinge: ["HingeConstraint"],

  // Lighting
  lighting: ["Lighting"],
  sky: ["Sky"],
  atmosphere: ["Atmosphere"],
  bloom: ["BloomEffect"],

  // Sound
  sound: ["Sound"],
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
  camera: ["Camera"],
  viewport: ["Camera"],

  // GUI
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
  animation: ["Animation"],
  animator: ["Animator"],
  animationtrack: ["AnimationTrack"],

  // Misc
  debris: ["Debris"],
  teams: ["Teams"],
  team: ["Team"],
} as const satisfies Record<string, readonly string[]>;

type AliasKey = keyof typeof ALIASES;

const NORMALIZED: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>(
  (Object.keys(ALIASES) as AliasKey[]).map((key) => [key.toLowerCase(), ALIASES[key]]),
);

export function resolveAliases(query: string): readonly string[] {
  const lower = query.toLowerCase().trim();
  return NORMALIZED.get(lower) ?? [];
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
